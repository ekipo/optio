import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock("../db/client.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../db/schema.js", () => ({
  repoPods: {
    id: "id",
    repoUrl: "repoUrl",
    state: "state",
    activeTaskCount: "activeTaskCount",
    updatedAt: "updatedAt",
    podName: "podName",
    podId: "podId",
  },
}));

const mockRuntimeCreate = vi.fn();
const mockRuntimeExec = vi.fn();
const mockRuntimeStatus = vi.fn();
const mockRuntimeDestroy = vi.fn();

vi.mock("./container-service.js", () => ({
  getRuntime: () => ({
    create: mockRuntimeCreate,
    exec: mockRuntimeExec,
    status: mockRuntimeStatus,
    destroy: mockRuntimeDestroy,
  }),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  lt: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { db } from "../db/client.js";
import {
  resolveImage,
  releaseRepoPodTask,
  cleanupIdleRepoPods,
  listRepoPods,
  getOrCreateRepoPod,
  execTaskInRepoPod,
} from "./repo-pool-service.js";

// ── resolveImage ────────────────────────────────────────────────────

describe("resolveImage", () => {
  const origEnv = process.env.OPTIO_AGENT_IMAGE;
  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.OPTIO_AGENT_IMAGE = origEnv;
    } else {
      delete process.env.OPTIO_AGENT_IMAGE;
    }
  });

  it("returns custom image when provided", () => {
    expect(resolveImage({ customImage: "my-org/my-image:v2" })).toBe("my-org/my-image:v2");
  });

  it("returns preset image tag when preset is valid", () => {
    expect(resolveImage({ preset: "node" })).toBe("optio-node:latest");
  });

  it("returns preset image for rust", () => {
    expect(resolveImage({ preset: "rust" })).toBe("optio-rust:latest");
  });

  it("returns preset image for python", () => {
    expect(resolveImage({ preset: "python" })).toBe("optio-python:latest");
  });

  it("returns preset image for go", () => {
    expect(resolveImage({ preset: "go" })).toBe("optio-go:latest");
  });

  it("returns preset image for full", () => {
    expect(resolveImage({ preset: "full" })).toBe("optio-full:latest");
  });

  it("returns preset image for base", () => {
    expect(resolveImage({ preset: "base" })).toBe("optio-base:latest");
  });

  it("prefers customImage over preset", () => {
    expect(resolveImage({ customImage: "custom:v1", preset: "node" })).toBe("custom:v1");
  });

  it("returns env OPTIO_AGENT_IMAGE when no config provided", () => {
    process.env.OPTIO_AGENT_IMAGE = "my-env-image:latest";
    expect(resolveImage()).toBe("my-env-image:latest");
  });

  it("returns default agent image when nothing configured", () => {
    delete process.env.OPTIO_AGENT_IMAGE;
    expect(resolveImage()).toBe("optio-agent:latest");
  });

  it("returns default when config is empty object", () => {
    delete process.env.OPTIO_AGENT_IMAGE;
    expect(resolveImage({})).toBe("optio-agent:latest");
  });

  it("falls through to default for invalid preset", () => {
    delete process.env.OPTIO_AGENT_IMAGE;
    expect(resolveImage({ preset: "nonexistent" as any })).toBe("optio-agent:latest");
  });
});

// ── releaseRepoPodTask ──────────────────────────────────────────────

describe("releaseRepoPodTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decrements the active task count via DB update", async () => {
    vi.mocked(db.update(undefined as any).set(undefined as any).where as any).mockResolvedValueOnce(
      [],
    );

    await releaseRepoPodTask("pod-1");

    expect(db.update).toHaveBeenCalled();
    expect(db.update(undefined as any).set).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedAt: expect.any(Date),
      }),
    );
  });
});

// ── cleanupIdleRepoPods ─────────────────────────────────────────────

describe("cleanupIdleRepoPods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when no idle pods exist", async () => {
    vi.mocked(db.select().from(undefined as any).where as any).mockResolvedValueOnce([]);

    const cleaned = await cleanupIdleRepoPods();
    expect(cleaned).toBe(0);
  });

  it("destroys idle pods and removes their records", async () => {
    const idlePod = {
      id: "pod-1",
      repoUrl: "https://github.com/org/repo",
      podName: "optio-repo-org-repo-abc1",
      podId: "k8s-pod-id-1",
      state: "ready",
      activeTaskCount: 0,
    };

    vi.mocked(db.select().from(undefined as any).where as any).mockResolvedValueOnce([idlePod]);

    mockRuntimeDestroy.mockResolvedValueOnce(undefined);
    vi.mocked(db.delete(undefined as any).where as any).mockResolvedValueOnce(undefined);

    const cleaned = await cleanupIdleRepoPods();
    expect(cleaned).toBe(1);
    expect(mockRuntimeDestroy).toHaveBeenCalledWith({
      id: idlePod.podId,
      name: idlePod.podName,
    });
  });

  it("continues cleanup even if one pod fails to destroy", async () => {
    const pods = [
      { id: "pod-1", repoUrl: "url1", podName: "pod-a", podId: "id-a", state: "ready" },
      { id: "pod-2", repoUrl: "url2", podName: "pod-b", podId: "id-b", state: "ready" },
    ];

    vi.mocked(db.select().from(undefined as any).where as any).mockResolvedValueOnce(pods);

    mockRuntimeDestroy
      .mockRejectedValueOnce(new Error("Failed to destroy"))
      .mockResolvedValueOnce(undefined);

    vi.mocked(db.delete(undefined as any).where as any).mockResolvedValue(undefined);

    const cleaned = await cleanupIdleRepoPods();
    // First pod fails, second succeeds
    expect(cleaned).toBe(1);
  });

  it("skips destroy if pod has no podName", async () => {
    const pod = {
      id: "pod-1",
      repoUrl: "url",
      podName: null,
      podId: null,
      state: "ready",
    };

    vi.mocked(db.select().from(undefined as any).where as any).mockResolvedValueOnce([pod]);
    vi.mocked(db.delete(undefined as any).where as any).mockResolvedValue(undefined);

    const cleaned = await cleanupIdleRepoPods();
    expect(cleaned).toBe(1);
    expect(mockRuntimeDestroy).not.toHaveBeenCalled();
  });
});

// ── listRepoPods ────────────────────────────────────────────────────

describe("listRepoPods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all pods from the database", async () => {
    const mockPods = [
      { id: "pod-1", repoUrl: "url1", podName: "p1", state: "ready" },
      { id: "pod-2", repoUrl: "url2", podName: "p2", state: "provisioning" },
    ];

    vi.mocked(db.select().from as any).mockResolvedValueOnce(mockPods);

    const result = await listRepoPods();
    expect(result).toEqual(mockPods);
  });
});

// ── getOrCreateRepoPod ──────────────────────────────────────────────

describe("getOrCreateRepoPod", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns existing ready pod when one exists and is running", async () => {
    const existingPod = {
      id: "pod-1",
      repoUrl: "https://github.com/org/repo",
      podName: "optio-repo-pod-1",
      podId: "k8s-id",
      state: "ready",
      activeTaskCount: 0,
    };

    vi.mocked(db.select().from(undefined as any).where as any).mockResolvedValueOnce([existingPod]);
    mockRuntimeStatus.mockResolvedValueOnce({ state: "running" });

    const result = await getOrCreateRepoPod("https://github.com/org/repo", "main", {});
    expect(result).toEqual(existingPod);
    expect(mockRuntimeCreate).not.toHaveBeenCalled();
  });

  it("cleans up and recreates when existing pod is dead", async () => {
    const deadPod = {
      id: "pod-old",
      repoUrl: "https://github.com/org/repo",
      podName: "optio-repo-dead",
      podId: "k8s-dead",
      state: "ready",
      activeTaskCount: 0,
    };

    // First query: find existing pod
    vi.mocked(db.select().from(undefined as any).where as any).mockResolvedValueOnce([deadPod]);

    // Status check: pod is gone
    mockRuntimeStatus.mockRejectedValueOnce(new Error("Pod not found"));

    // Delete old record
    vi.mocked(db.delete(undefined as any).where as any).mockResolvedValueOnce(undefined);

    // Create new pod: insert record
    const newRecord = { id: "pod-new", repoUrl: "https://github.com/org/repo" };
    vi.mocked(
      db.insert(undefined as any).values(undefined as any).returning as any,
    ).mockResolvedValueOnce([newRecord]);

    // Runtime create
    mockRuntimeCreate.mockResolvedValueOnce({ id: "k8s-new", name: "optio-repo-new" });

    // Update record to ready
    vi.mocked(db.update(undefined as any).set(undefined as any).where as any).mockResolvedValueOnce(
      [],
    );

    const result = await getOrCreateRepoPod("https://github.com/org/repo", "main", {});
    expect(result.state).toBe("ready");
    expect(result.podName).toBe("optio-repo-new");
    expect(mockRuntimeCreate).toHaveBeenCalled();
  });

  it("cleans up error state pods and recreates", async () => {
    const errorPod = {
      id: "pod-err",
      repoUrl: "https://github.com/org/repo",
      state: "error",
    };

    vi.mocked(db.select().from(undefined as any).where as any).mockResolvedValueOnce([errorPod]);

    // Delete error record
    vi.mocked(db.delete(undefined as any).where as any).mockResolvedValueOnce(undefined);

    // Create new
    vi.mocked(
      db.insert(undefined as any).values(undefined as any).returning as any,
    ).mockResolvedValueOnce([{ id: "pod-new" }]);
    mockRuntimeCreate.mockResolvedValueOnce({ id: "k8s-new", name: "new-pod" });
    vi.mocked(db.update(undefined as any).set(undefined as any).where as any).mockResolvedValueOnce(
      [],
    );

    const result = await getOrCreateRepoPod("https://github.com/org/repo", "main", {});
    expect(result.state).toBe("ready");
    expect(mockRuntimeCreate).toHaveBeenCalled();
  });
});

// ── execTaskInRepoPod ───────────────────────────────────────────────

describe("execTaskInRepoPod", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments active task count and execs a command in the pod", async () => {
    const pod = {
      id: "pod-1",
      repoUrl: "https://github.com/org/repo",
      repoBranch: "main",
      podName: "optio-repo-pod-1",
      podId: "k8s-id",
      state: "ready" as const,
      activeTaskCount: 0,
    };

    vi.mocked(db.update(undefined as any).set(undefined as any).where as any).mockResolvedValueOnce(
      [],
    );

    const mockSession = { stdout: [] };
    mockRuntimeExec.mockResolvedValueOnce(mockSession);

    const agentCommand = ['echo "hello"'];
    const env = { OPTIO_PROMPT: "test", OPTIO_REPO_BRANCH: "main" };

    const result = await execTaskInRepoPod(pod, "task-123", agentCommand, env);

    expect(result).toBe(mockSession);
    expect(db.update).toHaveBeenCalled();
    expect(mockRuntimeExec).toHaveBeenCalledWith(
      { id: pod.podId, name: pod.podName },
      ["bash", "-c", expect.stringContaining("task-123")],
      { tty: false },
    );
  });

  it("includes worktree creation in the exec script", async () => {
    const pod = {
      id: "pod-1",
      repoUrl: "https://github.com/org/repo",
      repoBranch: "main",
      podName: "optio-repo-pod-1",
      podId: "k8s-id",
      state: "ready" as const,
      activeTaskCount: 0,
    };

    vi.mocked(db.update(undefined as any).set(undefined as any).where as any).mockResolvedValueOnce(
      [],
    );
    mockRuntimeExec.mockResolvedValueOnce({ stdout: [] });

    await execTaskInRepoPod(pod, "task-abc", ['echo "test"'], {
      OPTIO_REPO_BRANCH: "main",
    });

    // Check that the exec script contains key operations
    const execCall = mockRuntimeExec.mock.calls[0];
    const script = execCall[1][2]; // ["bash", "-c", script]
    expect(script).toContain("git worktree add");
    expect(script).toContain("task-abc");
    expect(script).toContain("git fetch origin");
    expect(script).toContain('echo "test"');
    expect(script).toContain("AGENT_EXIT");
  });
});
