import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { taskDependencies, tasks } from "../db/schema.js";
import { TaskState, validateDAG, wouldCreateCycle } from "@optio/shared";
import * as taskService from "./task-service.js";
import { taskQueue } from "../workers/task-worker.js";
import { logger } from "../logger.js";

/**
 * Add dependencies to a task. Validates that:
 * 1. All dependency tasks exist
 * 2. No circular dependencies would be created
 * 3. No self-dependencies
 */
export async function addDependencies(taskId: string, dependsOnTaskIds: string[]) {
  if (dependsOnTaskIds.length === 0) return;

  // Check for self-dependency
  if (dependsOnTaskIds.includes(taskId)) {
    throw new Error("A task cannot depend on itself");
  }

  // Verify all dependency tasks exist
  for (const depId of dependsOnTaskIds) {
    const depTask = await taskService.getTask(depId);
    if (!depTask) {
      throw new Error(`Dependency task not found: ${depId}`);
    }
  }

  // Load existing edges to validate DAG
  const existingEdges = await getAllDependencyEdges();
  const newEdges: Array<[string, string]> = dependsOnTaskIds.map((depId) => [depId, taskId]);
  const allEdges = [...existingEdges, ...newEdges];

  const dagResult = validateDAG(allEdges);
  if (!dagResult.valid) {
    throw new Error(`Circular dependency detected. Involved tasks: ${dagResult.cycle.join(", ")}`);
  }

  // Insert dependencies
  for (const depId of dependsOnTaskIds) {
    await db
      .insert(taskDependencies)
      .values({ taskId, dependsOnTaskId: depId })
      .onConflictDoNothing();
  }

  logger.info({ taskId, dependsOnTaskIds }, "Dependencies added");
}

/**
 * Add a single dependency, with cycle detection.
 */
export async function addDependency(taskId: string, dependsOnTaskId: string) {
  if (taskId === dependsOnTaskId) {
    throw new Error("A task cannot depend on itself");
  }

  const depTask = await taskService.getTask(dependsOnTaskId);
  if (!depTask) {
    throw new Error(`Dependency task not found: ${dependsOnTaskId}`);
  }

  const existingEdges = await getAllDependencyEdges();
  if (wouldCreateCycle(existingEdges, dependsOnTaskId, taskId)) {
    throw new Error("Adding this dependency would create a circular dependency");
  }

  const [dep] = await db
    .insert(taskDependencies)
    .values({ taskId, dependsOnTaskId })
    .onConflictDoNothing()
    .returning();

  logger.info({ taskId, dependsOnTaskId }, "Dependency added");
  return dep;
}

/**
 * Remove a dependency.
 */
export async function removeDependency(taskId: string, dependsOnTaskId: string) {
  await db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.taskId, taskId),
        eq(taskDependencies.dependsOnTaskId, dependsOnTaskId),
      ),
    );
  logger.info({ taskId, dependsOnTaskId }, "Dependency removed");
}

/**
 * Get all tasks that a given task depends on.
 */
export async function getDependencies(taskId: string) {
  const deps = await db
    .select({
      id: taskDependencies.id,
      dependsOnTaskId: taskDependencies.dependsOnTaskId,
      createdAt: taskDependencies.createdAt,
      taskTitle: tasks.title,
      taskState: tasks.state,
    })
    .from(taskDependencies)
    .leftJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .where(eq(taskDependencies.taskId, taskId));

  return deps;
}

/**
 * Get all tasks that depend on a given task (downstream/dependents).
 */
export async function getDependents(taskId: string) {
  const deps = await db
    .select({
      id: taskDependencies.id,
      taskId: taskDependencies.taskId,
      createdAt: taskDependencies.createdAt,
      taskTitle: tasks.title,
      taskState: tasks.state,
    })
    .from(taskDependencies)
    .leftJoin(tasks, eq(tasks.id, taskDependencies.taskId))
    .where(eq(taskDependencies.dependsOnTaskId, taskId));

  return deps;
}

/**
 * Check if all dependencies for a task are satisfied (completed).
 */
export async function checkDependencyStatus(taskId: string) {
  const deps = await getDependencies(taskId);

  if (deps.length === 0) {
    return { allMet: true, total: 0, completed: 0, failed: 0, pending: 0 };
  }

  const completed = deps.filter(
    (d) => d.taskState === "completed" || d.taskState === "pr_opened",
  ).length;
  const failed = deps.filter((d) => d.taskState === "failed" || d.taskState === "cancelled").length;
  const pending = deps.length - completed - failed;

  return {
    allMet: completed === deps.length,
    total: deps.length,
    completed,
    failed,
    pending,
  };
}

/**
 * Called when a task completes successfully.
 * Checks all downstream dependents and queues them if all their dependencies are now met.
 */
export async function onTaskCompleted(taskId: string) {
  const dependents = await getDependents(taskId);

  for (const dep of dependents) {
    if (!dep.taskId) continue;

    const dependentTask = await taskService.getTask(dep.taskId);
    if (!dependentTask || dependentTask.state !== "pending") continue;

    const status = await checkDependencyStatus(dep.taskId);
    if (status.allMet) {
      logger.info(
        { taskId: dep.taskId, completedDependency: taskId },
        "All dependencies met, queuing task",
      );
      await taskService.transitionTask(dep.taskId, TaskState.QUEUED, "dependencies_met");
      await taskQueue.add(
        "process-task",
        { taskId: dep.taskId },
        {
          jobId: `${dep.taskId}-dep-${Date.now()}`,
          priority: dependentTask.priority ?? 100,
          attempts: dependentTask.maxRetries + 1,
          backoff: { type: "exponential", delay: 5000 },
        },
      );
    }
  }
}

/**
 * Called when a task fails or is cancelled.
 * Cascade-fails all downstream dependents that cannot proceed.
 */
export async function onTaskFailed(taskId: string) {
  const dependents = await getDependents(taskId);

  for (const dep of dependents) {
    if (!dep.taskId) continue;

    const dependentTask = await taskService.getTask(dep.taskId);
    if (!dependentTask) continue;

    // Only cascade-fail tasks that are still pending (haven't started)
    if (dependentTask.state !== "pending") continue;

    logger.info({ taskId: dep.taskId, failedDependency: taskId }, "Cascade-failing dependent task");

    // Transition pending → queued → failed (state machine requires this path)
    await taskService.transitionTask(dep.taskId, TaskState.QUEUED, "cascade_fail_prep");
    await taskService.transitionTask(
      dep.taskId,
      TaskState.FAILED,
      "dependency_failed",
      `Dependency task ${taskId} failed`,
    );

    // Recursively cascade-fail this task's dependents
    await onTaskFailed(dep.taskId);
  }
}

/**
 * Load all dependency edges from the database.
 * Returns edges as [dependsOn, task] (upstream → downstream).
 */
async function getAllDependencyEdges(): Promise<Array<[string, string]>> {
  const allDeps = await db.select().from(taskDependencies);
  return allDeps.map((d) => [d.dependsOnTaskId, d.taskId]);
}
