import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ─── Mocks ───

const mockExecute = vi.fn();

vi.mock("../db/client.js", () => ({
  db: {
    execute: (...args: unknown[]) => mockExecute(...args),
  },
}));

import { optioRoutes } from "./optio.js";

// ─── Helpers ───

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest("user", undefined as any);
  app.addHook("preHandler", (req, _reply, done) => {
    (req as any).user = { workspaceId: "ws-1", workspaceRole: "admin" };
    done();
  });
  await optioRoutes(app);
  await app.ready();
  return app;
}

describe("GET /api/optio/system-status", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("returns aggregate system status", async () => {
    mockExecute
      // 1. tasksByState
      .mockResolvedValueOnce([
        { state: "running", count: "3" },
        { state: "queued", count: "5" },
        { state: "provisioning", count: "1" },
        { state: "pr_opened", count: "2" },
      ])
      // 2. todayStats
      .mockResolvedValueOnce([{ completed_today: "10", failed_today: "2" }])
      // 3. podSummary
      .mockResolvedValueOnce([{ total_pods: "4", healthy_pods: "3", unhealthy_pods: "1" }])
      // 4. recentAlerts
      .mockResolvedValueOnce([
        {
          id: "alert-1",
          event_type: "oom_killed",
          repo_url: "https://github.com/org/repo",
          pod_name: "optio-repo-pod-0",
          message: "Container killed by OOM",
          created_at: "2026-03-28T10:00:00Z",
        },
      ])
      // 5. todayCost
      .mockResolvedValueOnce([{ cost_today: "5.1234", tasks_today: "12" }]);

    const res = await app.inject({
      method: "GET",
      url: "/api/optio/system-status",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Task counts
    expect(body.tasks.running).toBe(3);
    expect(body.tasks.queued).toBe(5);
    expect(body.tasks.provisioning).toBe(1);
    expect(body.tasks.prOpened).toBe(2);
    expect(body.tasks.completedToday).toBe(10);
    expect(body.tasks.failedToday).toBe(2);

    // Pod health
    expect(body.pods.total).toBe(4);
    expect(body.pods.healthy).toBe(3);
    expect(body.pods.unhealthy).toBe(1);

    // Queue depth = queued + pending + waiting_on_deps
    expect(body.queueDepth).toBe(5); // only queued was set

    // Cost
    expect(body.costToday).toBeCloseTo(5.1234);
    expect(body.tasksToday).toBe(12);

    // Alerts
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].type).toBe("oom_killed");
    expect(body.alerts[0].repoUrl).toBe("https://github.com/org/repo");
  });

  it("handles empty state gracefully", async () => {
    mockExecute
      .mockResolvedValueOnce([]) // no tasks
      .mockResolvedValueOnce([{ completed_today: "0", failed_today: "0" }])
      .mockResolvedValueOnce([{ total_pods: "0", healthy_pods: "0", unhealthy_pods: "0" }])
      .mockResolvedValueOnce([]) // no alerts
      .mockResolvedValueOnce([{ cost_today: "0", tasks_today: "0" }]);

    const res = await app.inject({
      method: "GET",
      url: "/api/optio/system-status",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.tasks.running).toBe(0);
    expect(body.tasks.queued).toBe(0);
    expect(body.tasks.completedToday).toBe(0);
    expect(body.tasks.failedToday).toBe(0);
    expect(body.pods.total).toBe(0);
    expect(body.queueDepth).toBe(0);
    expect(body.costToday).toBe(0);
    expect(body.alerts).toEqual([]);
  });

  it("computes queueDepth from queued + pending + waiting_on_deps", async () => {
    mockExecute
      .mockResolvedValueOnce([
        { state: "queued", count: "3" },
        { state: "pending", count: "2" },
        { state: "waiting_on_deps", count: "1" },
      ])
      .mockResolvedValueOnce([{ completed_today: "0", failed_today: "0" }])
      .mockResolvedValueOnce([{ total_pods: "0", healthy_pods: "0", unhealthy_pods: "0" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cost_today: "0", tasks_today: "0" }]);

    const res = await app.inject({
      method: "GET",
      url: "/api/optio/system-status",
    });

    const body = res.json();
    expect(body.queueDepth).toBe(6); // 3 + 2 + 1
  });

  it("runs all 5 queries in parallel", async () => {
    mockExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ completed_today: "0", failed_today: "0" }])
      .mockResolvedValueOnce([{ total_pods: "0", healthy_pods: "0", unhealthy_pods: "0" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cost_today: "0", tasks_today: "0" }]);

    await app.inject({
      method: "GET",
      url: "/api/optio/system-status",
    });

    // All 5 queries should have been called
    expect(mockExecute).toHaveBeenCalledTimes(5);
  });
});
