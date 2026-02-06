import { randomUUID } from "node:crypto";
import type { ParsedError } from "./error-analyzer.js";

export type SpawnCodingAgentParams = {
  error: ParsedError;
  logs: string;
  workspaceDir: string;
  strategy: "claude-code" | "gemini" | "sessions-spawn";
};

export type SpawnResult = {
  sessionId: string;
  command: string;
  task?: string;
  method: "shell" | "sessions-spawn";
};

/**
 * AutoSpawner: Spawn coding agents to fix build errors.
 *
 * Supports two methods:
 * 1. sessions-spawn (preferred) - Uses OpenClaw's native sub-agent system
 * 2. shell commands - Falls back to CLI tools like codex, claude-code
 */
export class AutoSpawner {
  /**
   * Spawn a coding agent to fix the error.
   */
  async spawnCodingAgent(params: SpawnCodingAgentParams): Promise<SpawnResult> {
    const sessionId = `recovery-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const task = this.buildRecoveryTask(params.error, params.logs, params.workspaceDir);

    // Prefer sessions-spawn for native integration
    if (params.strategy === "sessions-spawn" || params.strategy === "pi") {
      return {
        sessionId,
        command: "", // Not used for sessions-spawn
        task,
        method: "sessions-spawn",
      };
    }

    // Fall back to shell command for external CLIs
    const command = this.buildShellCommand(params.strategy, task, params.workspaceDir);
    return {
      sessionId,
      command,
      task,
      method: "shell",
    };
  }

  /**
   * Build recovery task description for coding agent.
   */
  buildRecoveryTask(error: ParsedError, logs: string, workspaceDir: string): string {
    const lastLogs = logs.split("\n").slice(-50).join("\n");

    return `
# Build Recovery Task

## Error Details
- **File:** ${error.file}:${error.line}:${error.column}
- **Error Code:** ${error.code}
- **Message:** ${error.message}

## Code Context
\`\`\`typescript
${error.context}
\`\`\`

## Build Log (last 50 lines)
\`\`\`
${lastLogs}
\`\`\`

## Instructions

1. **Analyze** the error and understand the root cause
2. **Fix** the issue in ${error.file}
3. **Verify** by running: \`cd ${workspaceDir} && pnpm build\`
4. **Report** success or failure

## Constraints
- Only modify files necessary to fix this specific error
- Do not introduce new dependencies unless absolutely necessary
- Ensure the fix doesn't break other functionality

## On Success
The build should complete without errors. Report what was changed.

## On Failure
If you cannot fix the error after 3 attempts, report the issue and suggest manual intervention.
    `.trim();
  }

  /**
   * Build shell command for external coding agent CLIs.
   * Supports: claude-code (Claude Code CLI) and gemini (Gemini CLI)
   */
  private buildShellCommand(
    strategy: Exclude<SpawnCodingAgentParams["strategy"], "sessions-spawn">,
    task: string,
    workspaceDir: string,
  ): string {
    // Escape task for shell
    const escapedTask = task.replace(/'/g, "'\\''").replace(/\n/g, "\\n");

    switch (strategy) {
      case "claude-code":
        // Claude Code CLI: claude -p for print mode (non-interactive)
        return `cd ${workspaceDir} && claude -p '${escapedTask}'`;

      case "gemini":
        // Gemini CLI: gemini for interactive prompts
        return `cd ${workspaceDir} && gemini '${escapedTask}'`;

      default:
        throw new Error(
          `Unknown coding agent strategy: ${strategy}. Supported: claude-code, gemini`,
        );
    }
  }

  /**
   * Get sessions_spawn parameters for native sub-agent execution.
   */
  getSessionsSpawnParams(
    task: string,
    options?: {
      label?: string;
      timeoutSeconds?: number;
      model?: string;
    },
  ): {
    task: string;
    label: string;
    runTimeoutSeconds: number;
    model?: string;
    cleanup: "delete" | "keep";
  } {
    return {
      task,
      label: options?.label ?? `recovery-${Date.now()}`,
      runTimeoutSeconds: options?.timeoutSeconds ?? 300, // 5 minute default
      model: options?.model,
      cleanup: "keep", // Keep session for debugging
    };
  }

  /**
   * Generate session ID for tracking.
   */
  generateSessionId(): string {
    return `recovery-${Date.now()}-${randomUUID().slice(0, 8)}`;
  }
}
