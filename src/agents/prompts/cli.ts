#!/usr/bin/env node

import { promises as fs } from "fs";
import path from "path";
import {
  startABTest,
  completeABTest,
  stopABTest,
  getABTestStatus,
  analyzeABTest,
} from "./ab-testing.js";
import {
  runWeeklyHealthReportJob,
  runHealthCheckJob,
  runABTestMonitoringJob,
  runPromptTuningCronJob,
} from "./health-cron.js";
// Import all the prompt tuning components
import { cli as promptCli } from "./index.js";
import {
  registerPromptVersion,
  listPrompts,
  getCurrentPrompt,
  setCurrentPrompt,
} from "./registry.js";

/**
 * Simple CLI for managing the prompt tuning framework.
 * Usage: node cli.js <command> [args...]
 */

const commands = {
  // Status and monitoring
  async status(): Promise<void> {
    await promptCli.status();
  },

  async "health-check"(): Promise<void> {
    const result = await runHealthCheckJob();
    console.log("Health check completed:", result.success ? "✅" : "❌");

    if (result.alerts.length > 0) {
      console.log("\nAlerts:");
      for (const alert of result.alerts) {
        console.log(`  ${alert}`);
      }
    }
  },

  async "generate-report"(workspaceDir?: string): Promise<void> {
    const workspace = workspaceDir || process.cwd();
    const filePath = await promptCli.generateReport(workspace);
    console.log(`✅ Report generated: ${filePath}`);
  },

  async "weekly-report"(workspaceDir?: string): Promise<void> {
    const workspace = workspaceDir || process.cwd();
    const result = await runWeeklyHealthReportJob(workspace);

    if (result.success) {
      console.log("✅ Weekly report generated successfully");
      console.log(`Report: ${result.reportPath}`);
      console.log(`Dashboard: ${result.dashboardPath}`);
    } else {
      console.error("❌ Failed to generate weekly report:", result.error);
    }
  },

  // Prompt management
  async "list-prompts"(): Promise<void> {
    await promptCli.listPrompts();
  },

  async "register-prompt"(
    name: string,
    contentFile: string,
    author?: string,
    rationale?: string,
  ): Promise<void> {
    if (!name || !contentFile) {
      console.error("Usage: register-prompt <name> <content-file> [author] [rationale]");
      return;
    }

    try {
      const content = await fs.readFile(contentFile, "utf-8");
      const version = await registerPromptVersion({
        name,
        content,
        metadata: {
          author: author || "cli-user",
          rationale: rationale || `Registered via CLI from ${contentFile}`,
          targetBehaviors: ["general-assistance"],
        },
        status: "testing", // Default to testing, not active
      });

      console.log(`✅ Registered prompt version: ${version.id}`);
      console.log(`Name: ${version.name}`);
      console.log(`Status: ${version.status}`);
    } catch (error) {
      console.error("❌ Failed to register prompt:", error);
    }
  },

  async "get-prompt"(name: string): Promise<void> {
    if (!name) {
      console.error("Usage: get-prompt <name>");
      return;
    }

    try {
      const prompt = await getCurrentPrompt(name);
      if (!prompt) {
        console.log(`No prompt found with name: ${name}`);
        return;
      }

      console.log(`=== Prompt: ${prompt.name} ===`);
      console.log(`ID: ${prompt.id}`);
      console.log(`Status: ${prompt.status}`);
      console.log(`Created: ${prompt.metadata.created}`);
      console.log(`Author: ${prompt.metadata.author || "unknown"}`);
      console.log(`Rationale: ${prompt.metadata.rationale || "none"}`);
      console.log("\nContent:");
      console.log(prompt.content);
    } catch (error) {
      console.error("❌ Failed to get prompt:", error);
    }
  },

  async "set-current"(name: string, versionId: string): Promise<void> {
    if (!name || !versionId) {
      console.error("Usage: set-current <name> <version-id>");
      return;
    }

    try {
      await setCurrentPrompt(name, versionId);
      console.log(`✅ Set ${name} current version to ${versionId}`);
    } catch (error) {
      console.error("❌ Failed to set current prompt:", error);
    }
  },

  // A/B testing
  async "list-experiments"(): Promise<void> {
    await promptCli.listExperiments();
  },

  async "start-ab-test"(
    name: string,
    baselineId: string,
    candidateId: string,
    trafficSplit?: string,
  ): Promise<void> {
    if (!name || !baselineId || !candidateId) {
      console.error("Usage: start-ab-test <name> <baseline-id> <candidate-id> [traffic-split]");
      console.error("Example: start-ab-test 'Reduce verbosity' abc123 def456 '50:50'");
      return;
    }

    let split = { baseline: 0.5, candidate: 0.5 };
    if (trafficSplit) {
      const parts = trafficSplit.split(":");
      if (parts.length === 2) {
        const baseline = parseInt(parts[0]);
        const candidate = parseInt(parts[1]);
        const total = baseline + candidate;
        split = { baseline: baseline / total, candidate: candidate / total };
      }
    }

    try {
      const experimentId = await startABTest({
        name,
        baselinePromptId: baselineId,
        candidatePromptId: candidateId,
        trafficSplit: split,
        minSampleSize: 50,
      });

      console.log(`✅ Started A/B test: ${experimentId}`);
    } catch (error) {
      console.error("❌ Failed to start A/B test:", error);
    }
  },

  async "analyze-ab-test"(experimentId: string): Promise<void> {
    if (!experimentId) {
      console.error("Usage: analyze-ab-test <experiment-id>");
      return;
    }

    try {
      const results = await analyzeABTest(experimentId);
      if (!results) {
        console.log("❌ Insufficient data for analysis");
        return;
      }

      console.log(`=== A/B Test Analysis: ${experimentId} ===`);
      console.log(`Winner: ${results.winner}`);
      console.log(`Improvement: ${results.improvement.toFixed(1)}%`);
      console.log(
        `Statistical significance: p=${results.significance.pValue.toFixed(3)} (${results.significance.isSignificant ? "significant" : "not significant"})`,
      );
      console.log("\nBaseline metrics:");
      console.log(`  Success rate: ${(results.baselineMetrics.successRate * 100).toFixed(1)}%`);
      console.log(`  Token efficiency: ${results.baselineMetrics.tokenEfficiency.toFixed(2)}x`);
      console.log(`  Error rate: ${(results.baselineMetrics.errorRate * 100).toFixed(1)}%`);
      console.log(`  Sample size: ${results.baselineMetrics.sampleSize}`);
      console.log("\nCandidate metrics:");
      console.log(`  Success rate: ${(results.candidateMetrics.successRate * 100).toFixed(1)}%`);
      console.log(`  Token efficiency: ${results.candidateMetrics.tokenEfficiency.toFixed(2)}x`);
      console.log(`  Error rate: ${(results.candidateMetrics.errorRate * 100).toFixed(1)}%`);
      console.log(`  Sample size: ${results.candidateMetrics.sampleSize}`);
    } catch (error) {
      console.error("❌ Failed to analyze A/B test:", error);
    }
  },

  async "complete-ab-test"(experimentId: string): Promise<void> {
    if (!experimentId) {
      console.error("Usage: complete-ab-test <experiment-id>");
      return;
    }

    try {
      const results = await completeABTest(experimentId);
      if (results) {
        console.log(`✅ Completed A/B test: ${experimentId}`);
        console.log(
          `Winner: ${results.winner} with ${results.improvement.toFixed(1)}% improvement`,
        );
      } else {
        console.log("❌ Could not complete A/B test - insufficient data");
      }
    } catch (error) {
      console.error("❌ Failed to complete A/B test:", error);
    }
  },

  async "stop-ab-test"(experimentId: string, reason?: string): Promise<void> {
    if (!experimentId) {
      console.error("Usage: stop-ab-test <experiment-id> [reason]");
      return;
    }

    try {
      await stopABTest(experimentId, reason);
      console.log(`✅ Stopped A/B test: ${experimentId}`);
    } catch (error) {
      console.error("❌ Failed to stop A/B test:", error);
    }
  },

  // Monitoring
  async "ab-test-monitor"(): Promise<void> {
    const result = await runABTestMonitoringJob();

    console.log("A/B test monitoring completed:", result.success ? "✅" : "❌");

    if (result.readyToComplete.length > 0) {
      console.log(`\n🔄 Ready to complete: ${result.readyToComplete.join(", ")}`);
    }

    if (result.alerts.length > 0) {
      console.log("\nAlerts:");
      for (const alert of result.alerts) {
        console.log(`  ${alert}`);
      }
    }
  },

  async "cron-job"(workspaceDir?: string, tasks?: string): Promise<void> {
    const workspace = workspaceDir || process.cwd();
    const taskList = tasks
      ? (tasks.split(",") as ("weekly-report" | "health-check" | "ab-test-monitor")[])
      : undefined;

    const result = await runPromptTuningCronJob({
      workspaceDir: workspace,
      tasks: taskList,
    });

    console.log("Cron job completed:", result.success ? "✅" : "❌");

    if (result.alerts.length > 0) {
      console.log("\nAlerts:");
      for (const alert of result.alerts) {
        console.log(`  ${alert}`);
      }
    }

    if (result.errors.length > 0) {
      console.log("\nErrors:");
      for (const error of result.errors) {
        console.error(`  ${error}`);
      }
    }
  },

  // Help
  async help(): Promise<void> {
    console.log("Prompt Tuning Framework CLI");
    console.log("");
    console.log("Commands:");
    console.log("  status                     - Show system status");
    console.log("  health-check               - Run health check");
    console.log("  generate-report [workspace] - Generate health report");
    console.log("  weekly-report [workspace]  - Generate weekly report");
    console.log("");
    console.log("Prompt Management:");
    console.log("  list-prompts              - List all registered prompts");
    console.log(
      "  register-prompt <name> <file> [author] [rationale] - Register new prompt version",
    );
    console.log("  get-prompt <name>         - Get current prompt");
    console.log("  set-current <name> <id>   - Set current prompt version");
    console.log("");
    console.log("A/B Testing:");
    console.log("  list-experiments          - List active experiments");
    console.log("  start-ab-test <name> <baseline> <candidate> [split] - Start A/B test");
    console.log("  analyze-ab-test <id>      - Analyze experiment results");
    console.log("  complete-ab-test <id>     - Complete and declare winner");
    console.log("  stop-ab-test <id> [reason] - Stop experiment");
    console.log("  ab-test-monitor           - Monitor experiment status");
    console.log("");
    console.log("Automation:");
    console.log("  cron-job [workspace] [tasks] - Run monitoring cron job");
    console.log("");
    console.log("Examples:");
    console.log("  node cli.js status");
    console.log("  node cli.js generate-report ~/workspace");
    console.log("  node cli.js start-ab-test 'Reduce tokens' abc123 def456 '70:30'");
    console.log("  node cli.js cron-job ~/workspace 'health-check,ab-test-monitor'");
  },
};

// CLI entry point
async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "help" || command === "-h" || command === "--help") {
    await commands.help();
    return;
  }

  const commandFn = commands[command as keyof typeof commands];
  if (!commandFn) {
    console.error(`Unknown command: ${command}`);
    console.error("Run 'help' to see available commands");
    process.exit(1);
  }

  try {
    await commandFn(...args);
  } catch (error) {
    console.error(`Command failed:`, error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { commands as promptTuningCli };
