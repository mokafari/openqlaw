/**
 * Build a specialized system prompt for diagnostic agents.
 * These agents are spawned to analyze tool failures and propose fixes.
 */
export function buildDiagnosticAgentPrompt(params: {
  toolName: string;
  errorRate: number;
  failingSessions: Array<{ sessionId: string; error: string; timestamp: number }>;
  sourceFile?: string;
  workspaceDir?: string;
}): string {
  const lines: string[] = [];

  lines.push("# Diagnostic Agent: Tool Failure Analysis");
  lines.push("");
  lines.push(
    `You are a diagnostic agent tasked with analyzing why the tool \`${params.toolName}\` is failing.`,
  );
  lines.push("");
  lines.push(`## Context`);
  lines.push(`- **Tool Name**: ${params.toolName}`);
  lines.push(`- **Error Rate**: ${(params.errorRate * 100).toFixed(1)}%`);
  lines.push(`- **Failing Sessions**: ${params.failingSessions.length} recent failures`);
  lines.push("");

  if (params.sourceFile) {
    lines.push("");
    lines.push(`### Source File (REQUIRED)`);
    lines.push(`\`\`\``);
    lines.push(params.sourceFile);
    lines.push(`\`\`\``);
    lines.push("");
    lines.push(
      `**IMPORTANT**: Read this source file using the \`read\` tool. Do NOT guess or invent file paths.`,
    );
    lines.push(`The file path is relative to the repository root at \`/Users/gustav/openclaw/\`.`);
    lines.push("");
  }

  lines.push("## Your Task");
  lines.push("");
  lines.push(
    "1. **Analyze the failures**: Review the error messages from failing sessions to identify patterns.",
  );
  lines.push(
    "2. **Identify root cause**: Determine why the tool is failing (e.g., missing validation, race condition, incorrect assumptions).",
  );
  lines.push("3. **Propose a fix**: Generate a code patch that addresses the root cause.");
  lines.push("");
  lines.push("## Available Tools");
  lines.push("");
  if (params.sourceFile) {
    lines.push(`- \`read\`: Read the source file: \`${params.sourceFile}\``);
  } else {
    lines.push("- `read`: Read the source file(s) for the tool");
  }
  lines.push("- `grep`: Search for related code patterns");
  lines.push("- `sessions_history`: Review session logs for more context");
  lines.push("- `apply_patch`: Propose your fix as a patch");
  lines.push("");
  lines.push("## Guidelines");
  lines.push("");
  lines.push("- Focus on the **root cause**, not just symptoms");
  lines.push("- Consider edge cases and error handling");
  lines.push("- Ensure your fix doesn't break existing functionality");
  lines.push("- Keep patches focused and minimal");
  lines.push("- Document your reasoning in the patch rationale");
  lines.push("");

  if (params.failingSessions.length > 0) {
    lines.push("## Recent Failures");
    lines.push("");
    for (let i = 0; i < Math.min(params.failingSessions.length, 5); i++) {
      const session = params.failingSessions[i];
      const date = new Date(session.timestamp).toISOString();
      lines.push(`### Session ${session.sessionId.slice(0, 8)} (${date})`);
      lines.push(`\`\`\``);
      lines.push(session.error);
      lines.push(`\`\`\``);
      lines.push("");
    }
    if (params.failingSessions.length > 5) {
      lines.push(`*... and ${params.failingSessions.length - 5} more failures*`);
      lines.push("");
    }
  }

  lines.push("## Expected Output");
  lines.push("");
  lines.push("After your analysis, use `apply_patch` to propose a fix. Include:");
  lines.push("- A clear rationale explaining the root cause");
  lines.push("- The patch that fixes the issue");
  lines.push("- Any additional context or considerations");
  lines.push("");

  return lines.join("\n");
}
