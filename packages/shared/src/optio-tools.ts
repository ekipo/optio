/**
 * Optio agent tool definitions.
 *
 * These JSON schemas describe the tools an AI agent (Claude / Codex) can call
 * to interact with the Optio API.  Each tool maps to one or more REST
 * endpoints on the API server.
 *
 * The agent executes HTTP calls directly — no MCP wrapping is involved.
 * Auth is handled via the requesting user's session token, which is injected
 * into the agent environment as `OPTIO_USER_SESSION_TOKEN`.
 */

export interface OptioToolParameter {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
  items?: { type: string };
}

export interface OptioToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, OptioToolParameter>;
    required?: string[];
  };
  /** The HTTP method + path(s) this tool maps to. Informational only. */
  endpoint: string;
}

// ── Tasks ───────────────────────────────────────────────────────────────

const listTasks: OptioToolDefinition = {
  name: "list_tasks",
  description:
    "List tasks with optional filters. Returns tasks sorted by creation date (newest first). " +
    "Use the state filter to find running, failed, queued tasks, etc.",
  parameters: {
    type: "object",
    properties: {
      state: {
        type: "string",
        description: "Filter by task state",
        enum: [
          "pending",
          "waiting_on_deps",
          "queued",
          "provisioning",
          "running",
          "needs_attention",
          "pr_opened",
          "completed",
          "failed",
          "cancelled",
        ],
      },
      repoUrl: {
        type: "string",
        description: "Filter by repository URL",
      },
      limit: {
        type: "number",
        description: "Maximum number of tasks to return (1-1000)",
        default: 50,
      },
      offset: {
        type: "number",
        description: "Number of tasks to skip for pagination",
        default: 0,
      },
    },
  },
  endpoint: "GET /api/tasks",
};

const getTask: OptioToolDefinition = {
  name: "get_task",
  description:
    "Get detailed information about a specific task, including PR status, error info, " +
    "pending reason, and pipeline progress. Use this to check on individual task status.",
  parameters: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "The UUID of the task to retrieve",
      },
    },
    required: ["taskId"],
  },
  endpoint: "GET /api/tasks/:id",
};

const createTask: OptioToolDefinition = {
  name: "create_task",
  description:
    "Create a new coding task. The task will be queued and picked up by the task worker. " +
    "Requires a title, prompt, repository URL, and agent type.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short descriptive title for the task",
      },
      prompt: {
        type: "string",
        description: "The detailed task description / instructions for the agent",
      },
      repoUrl: {
        type: "string",
        description: "Full HTTPS URL of the repository (e.g. https://github.com/owner/repo)",
      },
      agentType: {
        type: "string",
        description: "Which AI agent to use",
        enum: ["claude-code", "codex"],
      },
      repoBranch: {
        type: "string",
        description: "Base branch to create the task branch from (default: main)",
      },
      priority: {
        type: "number",
        description: "Task priority (lower = higher priority, default: 100)",
      },
      maxRetries: {
        type: "number",
        description: "Maximum number of automatic retries on failure (0-10, default: 3)",
      },
      dependsOn: {
        type: "array",
        description: "Array of task IDs that this task depends on",
        items: { type: "string" },
      },
    },
    required: ["title", "prompt", "repoUrl", "agentType"],
  },
  endpoint: "POST /api/tasks",
};

const retryTask: OptioToolDefinition = {
  name: "retry_task",
  description:
    "Retry a failed or cancelled task. Resets the task state and re-queues it for execution.",
  parameters: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "The UUID of the task to retry",
      },
    },
    required: ["taskId"],
  },
  endpoint: "POST /api/tasks/:id/retry",
};

const cancelTask: OptioToolDefinition = {
  name: "cancel_task",
  description: "Cancel a running or queued task. The agent process will be terminated.",
  parameters: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "The UUID of the task to cancel",
      },
    },
    required: ["taskId"],
  },
  endpoint: "POST /api/tasks/:id/cancel",
};

const bulkRetryFailed: OptioToolDefinition = {
  name: "bulk_retry_failed",
  description:
    "Retry all failed tasks in the current workspace. Returns the count of tasks that were re-queued.",
  parameters: {
    type: "object",
    properties: {},
  },
  endpoint: "POST /api/tasks/bulk/retry-failed",
};

const bulkCancelActive: OptioToolDefinition = {
  name: "bulk_cancel_active",
  description:
    "Cancel all running and queued tasks in the current workspace. " +
    "Returns the count of tasks that were cancelled.",
  parameters: {
    type: "object",
    properties: {},
  },
  endpoint: "POST /api/tasks/bulk/cancel-active",
};

const getTaskLogs: OptioToolDefinition = {
  name: "get_task_logs",
  description:
    "Retrieve logs for a specific task. Supports filtering by log type and " +
    "searching log content. Returns a summary line with total count and the " +
    "requested log entries. Large entries are truncated to fit context windows.",
  parameters: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "The UUID of the task whose logs to retrieve",
      },
      tail: {
        type: "number",
        description: "Number of most recent log entries to return (default: 100)",
        default: 100,
      },
      logType: {
        type: "string",
        description: "Filter by log type",
        enum: ["text", "tool_use", "tool_result", "thinking", "error", "info", "system"],
      },
      search: {
        type: "string",
        description: "Search string to filter log content (case-insensitive)",
      },
    },
    required: ["taskId"],
  },
  endpoint: "GET /api/tasks/:id/logs",
};

// ── Repos ───────────────────────────────────────────────────────────────

const listRepos: OptioToolDefinition = {
  name: "list_repos",
  description:
    "List all configured repositories in the current workspace, including their " +
    "settings, image presets, and concurrency configuration.",
  parameters: {
    type: "object",
    properties: {},
  },
  endpoint: "GET /api/repos",
};

const getRepo: OptioToolDefinition = {
  name: "get_repo",
  description:
    "Get detailed information about a specific repository, including its settings, " +
    "active pods, and task counts.",
  parameters: {
    type: "object",
    properties: {
      repoId: {
        type: "string",
        description: "The UUID of the repository to retrieve",
      },
    },
    required: ["repoId"],
  },
  endpoint: "GET /api/repos/:id",
};

const updateRepoSettings: OptioToolDefinition = {
  name: "update_repo_settings",
  description:
    "Update settings for a repository. Can change concurrency limits, Claude model, " +
    "review settings, image preset, resource limits, and more.",
  parameters: {
    type: "object",
    properties: {
      repoId: {
        type: "string",
        description: "The UUID of the repository to update",
      },
      maxConcurrentTasks: {
        type: "number",
        description: "Maximum concurrent tasks for this repo (1-50)",
      },
      maxPodInstances: {
        type: "number",
        description: "Maximum pod replicas for this repo (1-20)",
      },
      maxAgentsPerPod: {
        type: "number",
        description: "Maximum concurrent agents per pod (1-50)",
      },
      claudeModel: {
        type: "string",
        description: "Default Claude model (e.g. sonnet, opus)",
      },
      claudeEffort: {
        type: "string",
        description: "Claude effort level",
        enum: ["low", "medium", "high"],
      },
      reviewEnabled: {
        type: "boolean",
        description: "Enable automatic code review",
      },
      reviewTrigger: {
        type: "string",
        description: "When to trigger code review",
        enum: ["manual", "on_pr", "on_ci_pass"],
      },
      autoMerge: {
        type: "boolean",
        description: "Auto-merge PRs when CI passes and review is approved",
      },
      imagePreset: {
        type: "string",
        description: "Docker image preset for agent pods",
        enum: ["base", "node", "python", "go", "rust", "full"],
      },
    },
    required: ["repoId"],
  },
  endpoint: "PATCH /api/repos/:id",
};

// ── Issues ──────────────────────────────────────────────────────────────

const listIssues: OptioToolDefinition = {
  name: "list_issues",
  description:
    "Browse GitHub Issues across all configured repositories. Returns open issues " +
    "that can be assigned to Optio as tasks.",
  parameters: {
    type: "object",
    properties: {
      repoUrl: {
        type: "string",
        description: "Filter issues by repository URL",
      },
    },
  },
  endpoint: "GET /api/issues",
};

const assignIssue: OptioToolDefinition = {
  name: "assign_issue",
  description:
    "Assign a GitHub Issue to Optio, creating a task from the issue. " +
    "The issue title and body become the task title and prompt.",
  parameters: {
    type: "object",
    properties: {
      repoUrl: {
        type: "string",
        description: "Repository URL where the issue lives",
      },
      issueNumber: {
        type: "number",
        description: "The GitHub issue number to assign",
      },
    },
    required: ["repoUrl", "issueNumber"],
  },
  endpoint: "POST /api/issues/assign",
};

// ── Pods / Cluster ──────────────────────────────────────────────────────

const listPods: OptioToolDefinition = {
  name: "list_pods",
  description:
    "List all repo pods in the cluster with their status, active task counts, " +
    "and resource usage. Useful for monitoring infrastructure health.",
  parameters: {
    type: "object",
    properties: {},
  },
  endpoint: "GET /api/cluster",
};

const getPodHealth: OptioToolDefinition = {
  name: "get_pod_health",
  description:
    "Get health events and detailed status for a specific repo pod, including " +
    "crash history, OOM kills, and resource metrics.",
  parameters: {
    type: "object",
    properties: {
      podId: {
        type: "string",
        description: "The UUID of the repo pod to inspect",
      },
    },
    required: ["podId"],
  },
  endpoint: "GET /api/cluster/:id",
};

// ── Costs ───────────────────────────────────────────────────────────────

const getCostAnalytics: OptioToolDefinition = {
  name: "get_cost_analytics",
  description:
    "Get cost analytics including total spend, daily trends, cost by repo, " +
    "cost by task type, top expensive tasks, and monthly forecast.",
  parameters: {
    type: "object",
    properties: {
      days: {
        type: "number",
        description: "Number of days to look back (default: 30, max: 365)",
        default: 30,
      },
      repoUrl: {
        type: "string",
        description: "Filter costs to a specific repository",
      },
    },
  },
  endpoint: "GET /api/analytics/costs",
};

// ── System ──────────────────────────────────────────────────────────────

const getSystemStatus: OptioToolDefinition = {
  name: "get_system_status",
  description:
    "Get an aggregate system health summary: task counts by state, pod health, " +
    "queue depth, today's cost, and any active alerts (OOM kills, auth errors). " +
    "This gives a quick snapshot of the overall system status.",
  parameters: {
    type: "object",
    properties: {},
  },
  endpoint: "GET /api/optio/system-status",
};

// ── Watch ───────────────────────────────────────────────────────────────

const watchTask: OptioToolDefinition = {
  name: "watch_task",
  description:
    "Watch a task until it reaches a terminal state (completed, failed, cancelled). " +
    "Polls the task status at a configurable interval and returns when done. " +
    "Useful for waiting on a task to finish before taking further action.",
  parameters: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "The UUID of the task to watch",
      },
      timeoutSeconds: {
        type: "number",
        description: "Maximum time to wait in seconds (default: 600 = 10 minutes)",
        default: 600,
      },
      pollIntervalSeconds: {
        type: "number",
        description: "How often to poll in seconds (default: 10)",
        default: 10,
      },
    },
    required: ["taskId"],
  },
  endpoint: "GET /api/tasks/:id (polling)",
};

// ── Exports ─────────────────────────────────────────────────────────────

/**
 * All Optio tool definitions, indexed by name.
 *
 * Compatible with both Claude and Codex function-calling formats.
 */
export const OPTIO_TOOLS: Record<string, OptioToolDefinition> = {
  list_tasks: listTasks,
  get_task: getTask,
  create_task: createTask,
  retry_task: retryTask,
  cancel_task: cancelTask,
  bulk_retry_failed: bulkRetryFailed,
  bulk_cancel_active: bulkCancelActive,
  get_task_logs: getTaskLogs,
  list_repos: listRepos,
  get_repo: getRepo,
  update_repo_settings: updateRepoSettings,
  list_issues: listIssues,
  assign_issue: assignIssue,
  list_pods: listPods,
  get_pod_health: getPodHealth,
  get_cost_analytics: getCostAnalytics,
  get_system_status: getSystemStatus,
  watch_task: watchTask,
};

/**
 * Get the tool definitions as an array, in the format expected by
 * Claude / Codex function calling.
 */
export function getOptioToolDefinitions(): OptioToolDefinition[] {
  return Object.values(OPTIO_TOOLS);
}

/**
 * Terminal states for the watch_task tool polling loop.
 */
export const WATCH_TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

/**
 * Maximum length (in characters) for a single log entry content
 * before it gets truncated in get_task_logs responses.
 */
export const LOG_ENTRY_MAX_LENGTH = 2000;
