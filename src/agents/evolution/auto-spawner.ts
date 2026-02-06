import { randomUUID } from "node:crypto";
import type { ParsedError } from "./error-analyzer.js";

export type SpawnCodingAgentParams = {
  error: ParsedError;
  logs: string;
  workspaceDir: string;
  strategy: "claude-code" | "codex" | "opencode" | "pi";
};

export type SpawnResult = {
  sessionId: string;
  command: string;
};

/**
 * AutoSpawner: Spawn coding agents (claude-code/codex) with error context.
 */
export class AutoSpawner {
  /**
   * Spawn a coding agent to fix the error.
   */
  async spawnCodingAgent(params: SpawnCodingAgentParams): Promise<SpawnResult> {
    const prompt = this.buildRecoveryPrompt(params.error, params.logs);
    const command = this.buildCommand(params.strategy, prompt, params.workspaceDir);

    // Return command and sessionId - actual execution happens via bash tool
    const sessionId = `recovery-${Date.now()}-${randomUUID().slice(0, 8)}`;

    return {
      sessionId,
      command,
    };
  }

  /**
   * Build recovery prompt for coding agent.
   */
  private buildRecoveryPrompt(error: ParsedError, logs: string): string {
    const lastLogs = logs.split("\n").slice(-50).join("\n");

    return `
Build failed with error:

File: ${error.file}:${error.line}:${error.column}
Error: ${error.message}
Code: ${error.code}

Context:
\`\`\`typescript
${error.context}
\`\`\`

Full build log (last 50 lines):
\`\`\`
${lastLogs}
\`\`\`

TASK: Fix this error. Then verify the build succeeds by running: pnpm exec tsdown

When done, run:
openclaw system event --text "Build fixed: ${error.code}" --mode now
    `.trim();
  }

  /**
   * Build command to spawn coding agent.
   */
  private buildCommand(
    strategy: SpawnCodingAgentParams["strategy"],
    prompt: string,
    workspaceDir: string,
  ): string {
    // Escape prompt for shell
    const escapedPrompt = prompt.replace(/'/g, "'\\''");

    switch (strategy) {
      case "codex":
        return `cd ${workspaceDir} && codex exec --full-auto '${escapedPrompt}'`;

      case "claude-code":
        return `cd ${workspaceDir} && claude-code exec '${escapedPrompt}'`;

      case "opencode":
        return `cd ${workspaceDir} && opencode run '${escapedPrompt}'`;

      case "pi":
        return `cd ${workspaceDir} && pi '${escapedPrompt}'`;

      default:
        throw new Error(`Unknown coding agent strategy: ${strategy}`);
    }
  }

  /**
   * Monitor agent progress (returns sessionId for process tool monitoring).
   */
  getSessionId(command: string): string {
    // Extract sessionId from command or generate one
    // In practice, the bash tool will return a sessionId
    return `recovery-${Date.now()}`;
  }
}
