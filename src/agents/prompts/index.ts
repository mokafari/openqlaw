// Prompt Registry
export {
  type PromptVersion,
  type PromptExperiment,
  type PromptRegistry,
  generatePromptId,
  loadPromptRegistry,
  savePromptRegistry,
  registerPromptVersion,
  getCurrentPrompt,
  getPromptVersion,
  setCurrentPrompt,
  listPrompts,
  getPromptForTesting,
  createExperiment,
  completeExperiment,
  getActiveExperiments,
} from "./registry.js";

// Metrics Collection
export {
  type PromptSessionOutcome,
  type PromptMetrics,
  type PromptHealthReport,
  recordPromptSession,
  readPromptSessions,
  getMetricsForPrompt,
  generateHealthReport,
  saveHealthReport,
} from "../evolution/prompt-metrics.js";

// Session Attribution
export {
  type SessionPromptInfo,
  extractAndRegisterPrompt,
  buildVersionedSystemPrompt,
  recordSessionOutcome,
  getSessionPromptInfo,
  storeSessionPromptInfo,
  extractSessionErrors,
  initializePromptRegistry,
  extractBaselineTokens,
} from "./session-attribution.js";

// Session Hooks
export {
  onSessionStart,
  onSessionComplete,
  onSessionAbort,
  onUserFeedback,
  integrateWithAgentRunner,
  createSessionHooks,
  sessionHooks,
} from "./session-hooks.js";

// A/B Testing
export {
  type ABTestResults,
  startABTest,
  analyzeABTest,
  completeABTest,
  stopABTest,
  getABTestStatus,
  generateABTestReport,
} from "./ab-testing.js";

// Health Reports
export {
  generateWeeklyHealthReport,
  generatePromptHealthReport,
  generateDashboardSummary,
} from "./health-report.js";

// Convenience functions
export async function initializePromptTuningFramework(defaultSystemPrompt: string): Promise<void> {
  const { initializePromptRegistry } = await import("./session-attribution.js");
  await initializePromptRegistry(defaultSystemPrompt);
}

export async function quickHealthCheck(): Promise<{
  totalPrompts: number;
  activeExperiments: number;
  criticalIssues: number;
  overallHealth: "healthy" | "warning" | "critical";
}> {
  const { generateHealthReport } = await import("../evolution/prompt-metrics.js");
  const { getActiveExperiments } = await import("./registry.js");

  const [report, experiments] = await Promise.all([
    generateHealthReport("week"),
    getActiveExperiments(),
  ]);

  const criticalIssues = report.criticalIssues.filter((i) => i.severity === "critical").length;

  let overallHealth: "healthy" | "warning" | "critical";
  if (criticalIssues > 0) {
    overallHealth = "critical";
  } else if (report.summary.overallSuccessRate < 0.9) {
    overallHealth = "warning";
  } else {
    overallHealth = "healthy";
  }

  return {
    totalPrompts: report.summary.totalPrompts,
    activeExperiments: experiments.length,
    criticalIssues,
    overallHealth,
  };
}

// CLI-style functions for manual testing
export const cli = {
  async status(): Promise<void> {
    const health = await quickHealthCheck();
    console.log("=== Prompt Tuning Framework Status ===");
    console.log(`Total prompts: ${health.totalPrompts}`);
    console.log(`Active A/B tests: ${health.activeExperiments}`);
    console.log(`Critical issues: ${health.criticalIssues}`);
    console.log(`Overall health: ${health.overallHealth}`);
  },

  async generateReport(workspaceDir: string): Promise<string> {
    const { generateWeeklyHealthReport } = await import("./health-report.js");
    const { filePath } = await generateWeeklyHealthReport(workspaceDir);
    console.log(`Health report generated: ${filePath}`);
    return filePath;
  },

  async listPrompts(): Promise<void> {
    const { listPrompts } = await import("./registry.js");
    const prompts = await listPrompts();
    console.log("=== Registered Prompts ===");
    for (const prompt of prompts) {
      console.log(`${prompt.name}: ${prompt.current} (${prompt.versions} versions)`);
    }
  },

  async listExperiments(): Promise<void> {
    const { getABTestStatus } = await import("./ab-testing.js");
    const experiments = await getABTestStatus();
    console.log("=== Active A/B Tests ===");
    for (const exp of experiments) {
      console.log(
        `${exp.name}: ${exp.sampleSizes.baseline + exp.sampleSizes.candidate} sessions, ${exp.daysRunning.toFixed(1)} days`,
      );
      console.log(`  Ready to complete: ${exp.readyToComplete ? "Yes" : "No"}`);
    }
  },
};
