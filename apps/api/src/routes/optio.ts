import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { requireRole } from "../plugins/auth.js";
import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";

const NAMESPACE = "optio";
const POD_ROLE_LABEL = "optio.pod-role=optio";

// Cache status to avoid hitting the K8s API on every poll.
let cachedStatus: { ready: boolean; podName: string | null } | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10_000;

/** @internal Reset the cache — only for tests. */
export function _resetCache(): void {
  cachedStatus = null;
  cachedAt = 0;
}

function getK8sApi(): CoreV1Api {
  const kc = new KubeConfig();
  kc.loadFromDefault();
  return kc.makeApiClient(CoreV1Api);
}

async function getOptioPodStatus(): Promise<{
  ready: boolean;
  podName: string | null;
}> {
  const now = Date.now();
  if (cachedStatus && now - cachedAt < CACHE_TTL_MS) {
    return cachedStatus;
  }

  try {
    const k8s = getK8sApi();
    const res = await k8s.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: POD_ROLE_LABEL,
    });

    const pods = res.items ?? [];
    if (pods.length === 0) {
      cachedStatus = { ready: false, podName: null };
      cachedAt = now;
      return cachedStatus;
    }

    const pod = pods[0];
    const podName = pod.metadata?.name ?? null;
    const phase = pod.status?.phase;
    const conditions = pod.status?.conditions ?? [];
    const readyCondition = conditions.find((c) => c.type === "Ready");
    const ready = phase === "Running" && readyCondition?.status === "True";

    cachedStatus = { ready, podName };
    cachedAt = now;
    return cachedStatus;
  } catch {
    cachedStatus = { ready: false, podName: null };
    cachedAt = now;
    return cachedStatus;
  }
}

/**
 * Optio agent routes.
 *
 * Provides system-level endpoints consumed by the Optio agent to build
 * ambient context (system prompt injection) and support tool calls.
 */
export async function optioRoutes(app: FastifyInstance) {
  /**
   * GET /api/optio/status
   *
   * Simple pod readiness check for the Optio agent pod.
   */
  app.get("/api/optio/status", async (_req, reply) => {
    const enabled = process.env.OPTIO_POD_ENABLED === "true";
    if (!enabled) {
      return reply.send({ ready: false, podName: null, enabled: false });
    }

    const status = await getOptioPodStatus();
    return reply.send({ ...status, enabled: true });
  });

  /**
   * GET /api/optio/system-status
   *
   * Returns an aggregate system health summary that gets injected into the
   * Optio agent's system prompt on each request so it has ambient awareness.
   *
   * Includes:
   *   - Task counts by state (running, queued, failed today, completed today)
   *   - Pod health summary (total, healthy, unhealthy)
   *   - Queue depth (tasks in queued + provisioning)
   *   - Cost today
   *   - Active alerts (recent OOM kills, auth errors, etc.)
   */
  app.get(
    "/api/optio/system-status",
    { preHandler: [requireRole("viewer")] },
    async (req, reply) => {
      const workspaceId = req.user?.workspaceId ?? null;
      const wsFilter = workspaceId ? sql`AND workspace_id = ${workspaceId}` : sql``;

      // Run all queries in parallel for speed
      const [tasksByState, todayStats, podSummary, recentAlerts, todayCost] = await Promise.all([
        // 1. Current task counts by active state
        db.execute<{ state: string; count: string }>(sql`
          SELECT state, COUNT(*) AS count
          FROM tasks
          WHERE state IN ('running', 'provisioning', 'queued', 'pending', 'waiting_on_deps', 'needs_attention', 'pr_opened')
            ${wsFilter}
          GROUP BY state
        `),

        // 2. Today's completed and failed counts
        db.execute<{ completed_today: string; failed_today: string }>(sql`
          SELECT
            COUNT(*) FILTER (WHERE state = 'completed') AS completed_today,
            COUNT(*) FILTER (WHERE state = 'failed') AS failed_today
          FROM tasks
          WHERE created_at >= DATE_TRUNC('day', NOW())
            ${wsFilter}
        `),

        // 3. Pod health summary
        db.execute<{ total_pods: string; healthy_pods: string; unhealthy_pods: string }>(sql`
          SELECT
            COUNT(*) AS total_pods,
            COUNT(*) FILTER (WHERE state = 'ready') AS healthy_pods,
            COUNT(*) FILTER (WHERE state IN ('error', 'terminating')) AS unhealthy_pods
          FROM repo_pods
          ${workspaceId ? sql`WHERE workspace_id = ${workspaceId}` : sql``}
        `),

        // 4. Recent alerts — OOM kills, crashes, auth errors from last 24h
        db.execute<{
          id: string;
          event_type: string;
          repo_url: string;
          pod_name: string;
          message: string;
          created_at: string;
        }>(sql`
          SELECT
            id,
            event_type,
            repo_url,
            COALESCE(pod_name, '') AS pod_name,
            COALESCE(message, '') AS message,
            created_at::text
          FROM pod_health_events
          WHERE event_type IN ('crashed', 'oom_killed')
            AND created_at >= NOW() - INTERVAL '24 hours'
          ORDER BY created_at DESC
          LIMIT 10
        `),

        // 5. Cost today
        db.execute<{ cost_today: string; tasks_today: string }>(sql`
          SELECT
            COALESCE(SUM(CAST(cost_usd AS NUMERIC)), 0) AS cost_today,
            COUNT(*) AS tasks_today
          FROM tasks
          WHERE cost_usd IS NOT NULL
            AND created_at >= DATE_TRUNC('day', NOW())
            ${wsFilter}
        `),
      ]);

      // Build state counts map
      const stateCounts: Record<string, number> = {};
      for (const row of tasksByState) {
        stateCounts[row.state] = parseInt(row.count) || 0;
      }

      const today = todayStats[0] ?? { completed_today: "0", failed_today: "0" };
      const pods = podSummary[0] ?? { total_pods: "0", healthy_pods: "0", unhealthy_pods: "0" };
      const cost = todayCost[0] ?? { cost_today: "0", tasks_today: "0" };

      const queueDepth =
        (stateCounts.queued ?? 0) + (stateCounts.pending ?? 0) + (stateCounts.waiting_on_deps ?? 0);

      reply.send({
        tasks: {
          running: stateCounts.running ?? 0,
          provisioning: stateCounts.provisioning ?? 0,
          queued: stateCounts.queued ?? 0,
          pending: stateCounts.pending ?? 0,
          waitingOnDeps: stateCounts.waiting_on_deps ?? 0,
          needsAttention: stateCounts.needs_attention ?? 0,
          prOpened: stateCounts.pr_opened ?? 0,
          completedToday: parseInt(today.completed_today) || 0,
          failedToday: parseInt(today.failed_today) || 0,
        },
        pods: {
          total: parseInt(pods.total_pods) || 0,
          healthy: parseInt(pods.healthy_pods) || 0,
          unhealthy: parseInt(pods.unhealthy_pods) || 0,
        },
        queueDepth,
        costToday: parseFloat(cost.cost_today) || 0,
        tasksToday: parseInt(cost.tasks_today) || 0,
        alerts: recentAlerts.map((a) => ({
          id: a.id,
          type: a.event_type,
          repoUrl: a.repo_url,
          podName: a.pod_name,
          message: a.message,
          createdAt: a.created_at,
        })),
      });
    },
  );
}
