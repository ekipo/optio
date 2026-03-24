import { describe, it, expect } from "vitest";
import { buildAgentCommand, inferExitCode } from "./task-worker.js";
import { DEFAULT_MAX_TURNS_CODING, DEFAULT_MAX_TURNS_REVIEW } from "@optio/shared";

describe("buildAgentCommand", () => {
  const baseEnv = { OPTIO_PROMPT: "Do the task" };

  describe("claude-code", () => {
    it("produces a claude command with default max turns", () => {
      const cmd = buildAgentCommand("claude-code", baseEnv);
      const joined = cmd.join(" ");
      expect(joined).toContain("claude -p");
      expect(joined).toContain(`--max-turns ${DEFAULT_MAX_TURNS_CODING}`);
      expect(joined).toContain("--output-format stream-json");
      expect(joined).toContain("--dangerously-skip-permissions");
    });

    it("uses review max turns when isReview is true", () => {
      const cmd = buildAgentCommand("claude-code", baseEnv, { isReview: true });
      const joined = cmd.join(" ");
      expect(joined).toContain(`--max-turns ${DEFAULT_MAX_TURNS_REVIEW}`);
    });

    it("uses custom maxTurnsCoding when provided", () => {
      const cmd = buildAgentCommand("claude-code", baseEnv, { maxTurnsCoding: 42 });
      const joined = cmd.join(" ");
      expect(joined).toContain("--max-turns 42");
    });

    it("uses custom maxTurnsReview when isReview and maxTurnsReview provided", () => {
      const cmd = buildAgentCommand("claude-code", baseEnv, { isReview: true, maxTurnsReview: 5 });
      const joined = cmd.join(" ");
      expect(joined).toContain("--max-turns 5");
    });

    it("adds --resume flag when resumeSessionId is provided", () => {
      const cmd = buildAgentCommand("claude-code", baseEnv, {
        resumeSessionId: "sess-abc123",
      });
      const joined = cmd.join(" ");
      expect(joined).toContain("--resume");
      expect(joined).toContain("sess-abc123");
    });

    it("uses resumePrompt over env OPTIO_PROMPT", () => {
      const cmd = buildAgentCommand("claude-code", baseEnv, {
        resumePrompt: "Override prompt",
      });
      const joined = cmd.join(" ");
      expect(joined).toContain("Override prompt");
    });

    it("adds auth setup commands for max-subscription mode", () => {
      const env = {
        ...baseEnv,
        OPTIO_AUTH_MODE: "max-subscription",
        OPTIO_API_URL: "http://localhost:4000",
      };
      const cmd = buildAgentCommand("claude-code", env);
      const joined = cmd.join(" ");
      expect(joined).toContain("unset ANTHROPIC_API_KEY");
    });

    it("does not add auth setup for api-key mode", () => {
      const env = { ...baseEnv, OPTIO_AUTH_MODE: "api-key" };
      const cmd = buildAgentCommand("claude-code", env);
      const joined = cmd.join(" ");
      expect(joined).not.toContain("unset ANTHROPIC_API_KEY");
    });

    it("includes [optio] Running Claude Code marker", () => {
      const cmd = buildAgentCommand("claude-code", baseEnv);
      expect(cmd.some((c) => c.includes("[optio] Running Claude Code"))).toBe(true);
    });

    it("marks review in the log line when isReview is true", () => {
      const cmd = buildAgentCommand("claude-code", baseEnv, { isReview: true });
      expect(cmd.some((c) => c.includes("(review)"))).toBe(true);
    });
  });

  describe("codex", () => {
    it("produces a codex exec command", () => {
      const cmd = buildAgentCommand("codex", baseEnv);
      const joined = cmd.join(" ");
      expect(joined).toContain("codex exec --full-auto");
      expect(joined).toContain("--json");
    });

    it("includes the prompt in the codex command", () => {
      const cmd = buildAgentCommand("codex", { OPTIO_PROMPT: "Write some code" });
      const joined = cmd.join(" ");
      expect(joined).toContain("Write some code");
    });
  });

  describe("unknown agent type", () => {
    it("returns an error exit command", () => {
      const cmd = buildAgentCommand("unknown-agent", baseEnv);
      const joined = cmd.join(" ");
      expect(joined).toContain("exit 1");
      expect(joined).toContain("Unknown agent type");
    });
  });
});

describe("inferExitCode", () => {
  describe("claude-code", () => {
    it("returns 0 for clean logs", () => {
      expect(inferExitCode("claude-code", "Task completed successfully")).toBe(0);
    });

    it('returns 1 when logs contain "is_error":true', () => {
      expect(inferExitCode("claude-code", '{"type":"result","is_error":true}')).toBe(1);
    });

    it('returns 1 when logs contain "fatal:"', () => {
      expect(inferExitCode("claude-code", "fatal: repository not found")).toBe(1);
    });

    it("returns 1 when logs contain authentication_failed", () => {
      expect(inferExitCode("claude-code", "Error: authentication_failed")).toBe(1);
    });

    it("returns 1 when logs contain exit 1", () => {
      expect(inferExitCode("claude-code", "Process exited with exit 1")).toBe(1);
    });

    it("returns 0 for logs with partial is_error false", () => {
      expect(inferExitCode("claude-code", '{"is_error":false}')).toBe(0);
    });
  });

  describe("codex", () => {
    it("returns 0 for clean logs", () => {
      expect(inferExitCode("codex", '{"type":"message","content":"done"}')).toBe(0);
    });

    it("returns 1 when logs contain error type event", () => {
      expect(inferExitCode("codex", '{"type":"error","message":"something went wrong"}')).toBe(1);
    });

    it("returns 1 when logs contain OPENAI_API_KEY reference", () => {
      expect(inferExitCode("codex", "Error: OPENAI_API_KEY is not set")).toBe(1);
    });

    it("returns 1 when logs contain quota error", () => {
      expect(inferExitCode("codex", "Error: insufficient_quota exceeded")).toBe(1);
    });

    it("returns 1 when logs contain billing reference", () => {
      expect(inferExitCode("codex", "billing limit reached")).toBe(1);
    });

    it("returns 1 when logs contain invalid api key", () => {
      expect(inferExitCode("codex", "invalid api key provided")).toBe(1);
    });
  });

  describe("default (falls through to claude-code logic)", () => {
    it("returns 0 for empty logs", () => {
      expect(inferExitCode("unknown", "")).toBe(0);
    });

    it("returns 1 for is_error:true in any agent type", () => {
      expect(inferExitCode("other", '{"is_error":true}')).toBe(1);
    });
  });
});
