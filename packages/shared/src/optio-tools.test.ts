import { describe, it, expect } from "vitest";
import {
  OPTIO_TOOLS,
  getOptioToolDefinitions,
  WATCH_TERMINAL_STATES,
  LOG_ENTRY_MAX_LENGTH,
} from "./optio-tools.js";

describe("OPTIO_TOOLS", () => {
  it("defines 18 tools", () => {
    expect(Object.keys(OPTIO_TOOLS)).toHaveLength(18);
  });

  it("every tool has required fields", () => {
    for (const [name, tool] of Object.entries(OPTIO_TOOLS)) {
      expect(tool.name).toBe(name);
      expect(tool.description).toBeTruthy();
      expect(tool.parameters.type).toBe("object");
      expect(tool.endpoint).toBeTruthy();
    }
  });

  it("tools with required params list them correctly", () => {
    const toolsWithRequired = Object.values(OPTIO_TOOLS).filter(
      (t) => t.parameters.required && t.parameters.required.length > 0,
    );
    expect(toolsWithRequired.length).toBeGreaterThan(0);

    for (const tool of toolsWithRequired) {
      for (const reqParam of tool.parameters.required!) {
        expect(tool.parameters.properties).toHaveProperty(reqParam);
      }
    }
  });

  it("includes expected tool categories", () => {
    const names = Object.keys(OPTIO_TOOLS);
    // Tasks
    expect(names).toContain("list_tasks");
    expect(names).toContain("get_task");
    expect(names).toContain("create_task");
    expect(names).toContain("retry_task");
    expect(names).toContain("cancel_task");
    expect(names).toContain("bulk_retry_failed");
    expect(names).toContain("bulk_cancel_active");
    expect(names).toContain("get_task_logs");
    // Repos
    expect(names).toContain("list_repos");
    expect(names).toContain("get_repo");
    expect(names).toContain("update_repo_settings");
    // Issues
    expect(names).toContain("list_issues");
    expect(names).toContain("assign_issue");
    // Pods
    expect(names).toContain("list_pods");
    expect(names).toContain("get_pod_health");
    // Costs
    expect(names).toContain("get_cost_analytics");
    // System
    expect(names).toContain("get_system_status");
    // Watch
    expect(names).toContain("watch_task");
  });

  it("create_task requires title, prompt, repoUrl, agentType", () => {
    const createTask = OPTIO_TOOLS.create_task;
    expect(createTask.parameters.required).toEqual(
      expect.arrayContaining(["title", "prompt", "repoUrl", "agentType"]),
    );
  });

  it("watch_task has timeout and poll interval defaults", () => {
    const watchTask = OPTIO_TOOLS.watch_task;
    expect(watchTask.parameters.properties.timeoutSeconds.default).toBe(600);
    expect(watchTask.parameters.properties.pollIntervalSeconds.default).toBe(10);
  });

  it("get_task_logs has tail default of 100", () => {
    const logs = OPTIO_TOOLS.get_task_logs;
    expect(logs.parameters.properties.tail.default).toBe(100);
  });
});

describe("getOptioToolDefinitions", () => {
  it("returns all tools as an array", () => {
    const tools = getOptioToolDefinitions();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toHaveLength(18);
  });
});

describe("WATCH_TERMINAL_STATES", () => {
  it("includes completed, failed, cancelled", () => {
    expect(WATCH_TERMINAL_STATES.has("completed")).toBe(true);
    expect(WATCH_TERMINAL_STATES.has("failed")).toBe(true);
    expect(WATCH_TERMINAL_STATES.has("cancelled")).toBe(true);
  });

  it("does not include active states", () => {
    expect(WATCH_TERMINAL_STATES.has("running")).toBe(false);
    expect(WATCH_TERMINAL_STATES.has("queued")).toBe(false);
  });
});

describe("LOG_ENTRY_MAX_LENGTH", () => {
  it("is a positive number", () => {
    expect(LOG_ENTRY_MAX_LENGTH).toBeGreaterThan(0);
    expect(LOG_ENTRY_MAX_LENGTH).toBe(2000);
  });
});
