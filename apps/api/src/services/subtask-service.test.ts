import { vi, describe, it, expect, beforeEach } from "vitest";

// vi.hoisted creates variables available in the hoisted mock factories
const mockSubtasksHolder = vi.hoisted(() => ({ subtasks: [] as any[] }));

// Mock the DB client to avoid real PostgreSQL connections
vi.mock("../db/client.js", () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => Promise.resolve(mockSubtasksHolder.subtasks),
    orderBy: () => Promise.resolve(mockSubtasksHolder.subtasks),
  };
  return { db: chain };
});

// Mock task-service to avoid DB connections
vi.mock("./task-service.js", () => ({
  getTask: vi.fn(),
  createTask: vi.fn(),
  transitionTask: vi.fn(),
}));

// Mock the BullMQ queue to avoid Redis connections
vi.mock("../workers/task-worker.js", () => ({
  taskQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

import { checkBlockingSubtasks } from "./subtask-service.js";

beforeEach(() => {
  mockSubtasksHolder.subtasks = [];
  vi.clearAllMocks();
});

describe("checkBlockingSubtasks", () => {
  it("returns allComplete: true and zero counts when there are no blocking subtasks", async () => {
    mockSubtasksHolder.subtasks = [];
    const result = await checkBlockingSubtasks("parent-1");
    expect(result).toEqual({
      allComplete: true,
      total: 0,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
    });
  });

  it("returns allComplete: true when all subtasks are completed", async () => {
    mockSubtasksHolder.subtasks = [
      { state: "completed" },
      { state: "completed" },
      { state: "completed" },
    ];
    const result = await checkBlockingSubtasks("parent-1");
    expect(result.allComplete).toBe(true);
    expect(result.total).toBe(3);
    expect(result.completed).toBe(3);
    expect(result.running).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.pending).toBe(0);
  });

  it("returns allComplete: false when some subtasks are still running", async () => {
    mockSubtasksHolder.subtasks = [{ state: "completed" }, { state: "running" }];
    const result = await checkBlockingSubtasks("parent-1");
    expect(result.allComplete).toBe(false);
    expect(result.total).toBe(2);
    expect(result.completed).toBe(1);
    expect(result.running).toBe(1);
  });

  it("counts provisioning and queued states as running", async () => {
    mockSubtasksHolder.subtasks = [
      { state: "provisioning" },
      { state: "queued" },
      { state: "running" },
    ];
    const result = await checkBlockingSubtasks("parent-1");
    expect(result.allComplete).toBe(false);
    expect(result.running).toBe(3);
  });

  it("counts failed subtasks correctly", async () => {
    mockSubtasksHolder.subtasks = [
      { state: "completed" },
      { state: "failed" },
      { state: "failed" },
    ];
    const result = await checkBlockingSubtasks("parent-1");
    expect(result.allComplete).toBe(false);
    expect(result.failed).toBe(2);
    expect(result.completed).toBe(1);
  });

  it("counts pending subtasks correctly", async () => {
    mockSubtasksHolder.subtasks = [{ state: "pending" }, { state: "completed" }];
    const result = await checkBlockingSubtasks("parent-1");
    expect(result.allComplete).toBe(false);
    expect(result.pending).toBe(1);
    expect(result.completed).toBe(1);
  });

  it("returns allComplete: false for mixed incomplete states", async () => {
    mockSubtasksHolder.subtasks = [
      { state: "completed" },
      { state: "running" },
      { state: "failed" },
      { state: "pending" },
    ];
    const result = await checkBlockingSubtasks("parent-1");
    expect(result.allComplete).toBe(false);
    expect(result.total).toBe(4);
    expect(result.completed).toBe(1);
    expect(result.running).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.pending).toBe(1);
  });

  it("returns allComplete: false when only failed subtasks exist", async () => {
    mockSubtasksHolder.subtasks = [{ state: "failed" }, { state: "failed" }];
    const result = await checkBlockingSubtasks("parent-1");
    expect(result.allComplete).toBe(false);
    expect(result.failed).toBe(2);
    expect(result.completed).toBe(0);
  });

  it("returns total count matching the number of blocking subtasks", async () => {
    mockSubtasksHolder.subtasks = [
      { state: "completed" },
      { state: "completed" },
      { state: "running" },
    ];
    const result = await checkBlockingSubtasks("parent-1");
    expect(result.total).toBe(3);
  });
});
