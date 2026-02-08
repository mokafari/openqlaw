import { getReflexionSystem } from "./reflexion.js";

/**
 * Build a specialized system prompt for diagnostic agents.
 * These agents are spawned to analyze tool failures and propose fixes.
 */
export async function buildDiagnosticAgentPrompt(params: {
  toolName: string;
  errorRate: number;
  failingSessions: Array<{ sessionId: string; error: string; timestamp: number }>;
  sourceFile?: string;
  workspaceDir?: string;
  gitContext?: string;
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

  // Add reflexion insights if available
  try {
    const reflexion = getReflexionSystem();
    const suggestions = await reflexion.generateImprovementSuggestions();
    if (suggestions.length > 0) {
      lines.push(`## Reflexion Insights`);
      lines.push(``);
      lines.push(`Recent failure analysis suggests:`);
      for (const suggestion of suggestions.slice(0, 5)) {
        lines.push(`- ${suggestion}`);
      }
      lines.push(``);
    }

    // Get tool-specific reflexion episodes
    const episodes = await reflexion.getRecentEpisodes(20);
    const toolEpisodes = episodes
      .filter(
        (ep) =>
          ep.toolsUsed.includes(params.toolName) &&
          (ep.outcome === "failure" || ep.outcome === "aborted"),
      )
      .slice(0, 3);

    if (toolEpisodes.length > 0) {
      lines.push(`## Recent ${params.toolName} Failures`);
      lines.push(``);
      for (const ep of toolEpisodes) {
        lines.push(
          `**${ep.timestamp.split("T")[0]}** (h=${ep.heuristic.toFixed(2)}): ${ep.task.slice(0, 80)}`,
        );
        if (ep.reflection?.lessonsLearned) {
          lines.push(`Lessons: ${ep.reflection.lessonsLearned.slice(0, 2).join("; ")}`);
        }
        lines.push(``);
      }
    }
  } catch (err) {
    // Reflexion data not available, continue without it
  }

  lines.push("");

  if (params.sourceFile) {
    const fullPath = `/Users/gustav/openclaw/${params.sourceFile}`;
    lines.push("");
    lines.push(`### Source File (REQUIRED)`);
    lines.push(`\`\`\``);
    lines.push(fullPath);
    lines.push(`\`\`\``);
    lines.push("");
    lines.push(
      `**CRITICAL**: To read this file, you MUST use the \`read\` tool with the \`file_path\` parameter:`,
    );
    lines.push(`\`\`\`json`);
    lines.push(`{ "file_path": "${fullPath}" }`);
    lines.push(`\`\`\``);
    lines.push("");
    lines.push(`⚠️ **NEVER call read() without file_path**. The parameter is required. Example:`);
    lines.push(`\`\`\``);
    lines.push(`read(file_path: "${fullPath}")`);
    lines.push(`\`\`\``);
    lines.push("");
    lines.push(`Do NOT guess or invent file paths. Use ONLY the path provided above.`);
    lines.push("");
  }

  if (params.gitContext) {
    lines.push("");
    lines.push(`### Git Context`);
    lines.push("");
    lines.push(params.gitContext);
    lines.push("");
    lines.push(
      `Use this context to understand who wrote the error-prone code and when it was last modified.`,
    );
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
    const fullPath = `/Users/gustav/openclaw/${params.sourceFile}`;
    lines.push(
      `- \`read(file_path: "${fullPath}")\`: Read the source file (ALWAYS include file_path!)`,
    );
  } else {
    lines.push(
      '- `read(file_path: "/path/to/file")`: Read source files (ALWAYS include file_path parameter!)',
    );
  }
  lines.push("- `grep`: Search for related code patterns");
  lines.push("- `sessions_history`: Review session logs for more context");
  lines.push("- `apply_patch`: Propose your fix as a patch");
  lines.push("");
  lines.push("## Guidelines");
  lines.push("");
  lines.push("- **ALWAYS include file_path when calling read()** - never call read() without it");
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
