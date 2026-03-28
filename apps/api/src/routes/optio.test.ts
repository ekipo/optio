import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ─── Mocks ───

const mockExecute = vi.fn();

vi.mock("../db/client.js", () => ({
  db: {
    execute: (...args: unknown[]) => mockExecute(...args),
  },
}));

const mockListNamespacedPod = vi.fn();

vi.mock("@kubernetes/client-node", () => {
  return {
    KubeConfig: vi.fn().mockImplementation(() => ({
      loadFromDefault: vi.fn(),
      makeApiClient: vi.fn(() => ({
        listNamespacedPod: mockListNamespacedPod,
      })),
    })),
    CoreV1Api: vi.fn(),
  };
});

import { optioRoutes, _resetCache } from "./optio.js";

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

describe("GET /api/optio/status", () => {
  let app: FastifyInstance;
  const originalEnv = process.env.OPTIO_POD_ENABLED;

  beforeEach(async () => {
    vi.clearAllMocks();
    _resetCache();
    process.env.OPTIO_POD_ENABLED = "true";
    app = await buildTestApp();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OPTIO_POD_ENABLED;
    } else {
      process.env.OPTIO_POD_ENABLED = originalEnv;
    }
  });

  it("returns enabled:false when OPTIO_POD_ENABLED is not set", async () => {
    delete process.env.OPTIO_POD_ENABLED;

    const res = await app.inject({ method: "GET", url: "/api/optio/status" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ready).toBe(false);
    expect(body.podName).toBeNull();
    expect(body.enabled).toBe(false);
  });

  it("returns ready:true when optio pod is running", async () => {
    mockListNamespacedPod.mockResolvedValue({
      items: [
        {
          metadata: { name: "optio-optio-abc123" },
          status: {
            phase: "Running",
            conditions: [{ type: "Ready", status: "True" }],
          },
        },
      ],
    });

    const res = await app.inject({ method: "GET", url: "/api/optio/status" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ready).toBe(true);
    expect(body.podName).toBe("optio-optio-abc123");
    expect(body.enabled).toBe(true);
  });

  it("returns ready:false when no pods found", async () => {
    mockListNamespacedPod.mockResolvedValue({ items: [] });

    const res = await app.inject({ method: "GET", url: "/api/optio/status" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ready).toBe(false);
    expect(body.podName).toBeNull();
  });

  it("returns ready:false when pod is not ready", async () => {
    mockListNamespacedPod.mockResolvedValue({
      items: [
        {
          metadata: { name: "optio-optio-abc123" },
          status: {
            phase: "Pending",
            conditions: [{ type: "Ready", status: "False" }],
          },
        },
      ],
    });

    const res = await app.inject({ method: "GET", url: "/api/optio/status" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ready).toBe(false);
    expect(body.podName).toBe("optio-optio-abc123");
  });

  it("returns ready:false when K8s API fails", async () => {
    mockListNamespacedPod.mockRejectedValue(new Error("connection refused"));

    const res = await app.inject({ method: "GET", url: "/api/optio/status" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ready).toBe(false);
    expect(body.podName).toBeNull();
  });
});

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
