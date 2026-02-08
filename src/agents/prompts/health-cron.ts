import { promises as fs } from "fs";
import path from "path";
import { generateWeeklyHealthReport, generateDashboardSummary } from "./health-report.js";
import { quickHealthCheck } from "./index.js";

/**
 * Cron job to generate weekly health reports.
 * Should be scheduled to run weekly (e.g., Sunday at 3 AM).
 */
export async function runWeeklyHealthReportJob(workspaceDir: string): Promise<{
  success: boolean;
  reportPath?: string;
  dashboardPath?: string;
  error?: string;
}> {
  try {
    console.log("Starting weekly prompt health report generation...");

    // Generate the weekly health report
    const { report, filePath: reportPath } = await generateWeeklyHealthReport(workspaceDir);
    console.log(`Health report generated: ${reportPath}`);

    // Update the dashboard
    const { filePath: dashboardPath } = await generateDashboardSummary(workspaceDir);
    console.log(`Dashboard updated: ${dashboardPath}`);

    // Log summary
    console.log("=== Weekly Health Report Summary ===");
    console.log(`Total prompts: ${report.summary.totalPrompts}`);
    console.log(`Total sessions: ${report.summary.totalSessions}`);
    console.log(`Overall success rate: ${(report.summary.overallSuccessRate * 100).toFixed(1)}%`);
    console.log(
      `Critical issues: ${report.criticalIssues.filter((i) => i.severity === "critical").length}`,
    );
    console.log(`A/B test results: ${report.abTestResults.length}`);

    // Alert on critical issues
    const criticalIssues = report.criticalIssues.filter((i) => i.severity === "critical");
    if (criticalIssues.length > 0) {
      console.warn("⚠️ CRITICAL ISSUES DETECTED:");
      for (const issue of criticalIssues) {
        console.warn(`- ${issue.promptName}: ${issue.issue}`);
        console.warn(`  Recommendation: ${issue.recommendation}`);
      }
    }

    // Alert on poor performance
    if (report.summary.overallSuccessRate < 0.85) {
      console.warn(
        `⚠️ LOW SUCCESS RATE: ${(report.summary.overallSuccessRate * 100).toFixed(1)}% - Review prompt performance`,
      );
    }

    return {
      success: true,
      reportPath,
      dashboardPath,
    };
  } catch (error) {
    console.error("Failed to generate weekly health report:", error);
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * Quick health check job for more frequent monitoring.
 * Should be scheduled to run daily or multiple times per day.
 */
export async function runHealthCheckJob(): Promise<{
  success: boolean;
  health?: Awaited<ReturnType<typeof quickHealthCheck>>;
  alerts: string[];
  error?: string;
}> {
  try {
    const health = await quickHealthCheck();
    const alerts: string[] = [];

    // Check for critical issues
    if (health.overallHealth === "critical") {
      alerts.push(`CRITICAL: Prompt system has ${health.criticalIssues} critical issues`);
    } else if (health.overallHealth === "warning") {
      alerts.push(`WARNING: Prompt system performance degraded`);
    }

    // Check for stale A/B tests (this would need additional data)
    if (health.activeExperiments > 5) {
      alerts.push(
        `INFO: Many active A/B tests (${health.activeExperiments}) - consider completing some`,
      );
    }

    if (alerts.length > 0) {
      console.log("=== Prompt Health Alerts ===");
      for (const alert of alerts) {
        console.log(alert);
      }
    }

    return {
      success: true,
      health,
      alerts,
    };
  } catch (error) {
    console.error("Failed to run health check:", error);
    return {
      success: false,
      alerts: [`ERROR: Health check failed - ${String(error)}`],
      error: String(error),
    };
  }
}

/**
 * A/B test monitoring job.
 * Checks if any experiments are ready to complete.
 */
export async function runABTestMonitoringJob(): Promise<{
  success: boolean;
  readyToComplete: string[];
  alerts: string[];
  error?: string;
}> {
  try {
    const { getABTestStatus } = await import("./ab-testing.js");
    const experiments = await getABTestStatus();

    const readyToComplete = experiments
      .filter((exp) => exp.readyToComplete)
      .map((exp) => exp.experimentId);

    const alerts: string[] = [];

    // Alert on ready experiments
    for (const exp of experiments.filter((exp) => exp.readyToComplete)) {
      alerts.push(
        `A/B test "${exp.name}" is ready to complete (${exp.sampleSizes.baseline + exp.sampleSizes.candidate} sessions)`,
      );
    }

    // Alert on long-running experiments
    for (const exp of experiments.filter((exp) => exp.daysRunning > 14)) {
      alerts.push(
        `A/B test "${exp.name}" has been running for ${exp.daysRunning.toFixed(1)} days - consider reviewing`,
      );
    }

    if (alerts.length > 0) {
      console.log("=== A/B Test Alerts ===");
      for (const alert of alerts) {
        console.log(alert);
      }
    }

    return {
      success: true,
      readyToComplete,
      alerts,
    };
  } catch (error) {
    console.error("Failed to run A/B test monitoring:", error);
    return {
      success: false,
      readyToComplete: [],
      alerts: [`ERROR: A/B test monitoring failed - ${String(error)}`],
      error: String(error),
    };
  }
}

/**
 * Create a comprehensive cron job that runs all monitoring tasks.
 */
export async function runPromptTuningCronJob(params: {
  workspaceDir: string;
  tasks?: ("weekly-report" | "health-check" | "ab-test-monitor")[];
}): Promise<{
  success: boolean;
  results: Record<string, any>;
  alerts: string[];
  errors: string[];
}> {
  const tasks = params.tasks || ["health-check", "ab-test-monitor"];
  const results: Record<string, any> = {};
  const allAlerts: string[] = [];
  const errors: string[] = [];

  for (const task of tasks) {
    try {
      switch (task) {
        case "weekly-report":
          const weeklyResult = await runWeeklyHealthReportJob(params.workspaceDir);
          results.weeklyReport = weeklyResult;
          if (!weeklyResult.success && weeklyResult.error) {
            errors.push(`Weekly report: ${weeklyResult.error}`);
          }
          break;

        case "health-check":
          const healthResult = await runHealthCheckJob();
          results.healthCheck = healthResult;
          allAlerts.push(...healthResult.alerts);
          if (!healthResult.success && healthResult.error) {
            errors.push(`Health check: ${healthResult.error}`);
          }
          break;

        case "ab-test-monitor":
          const abTestResult = await runABTestMonitoringJob();
          results.abTestMonitor = abTestResult;
          allAlerts.push(...abTestResult.alerts);
          if (!abTestResult.success && abTestResult.error) {
            errors.push(`A/B test monitor: ${abTestResult.error}`);
          }
          break;
      }
    } catch (error) {
      errors.push(`Task ${task}: ${String(error)}`);
    }
  }

  return {
    success: errors.length === 0,
    results,
    alerts: allAlerts,
    errors,
  };
}
