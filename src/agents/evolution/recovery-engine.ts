import type { ParsedError } from "./error-analyzer.js";

export type RecoveryStrategy = "auto-fix" | "spawn-agent" | "escalate";

export type RecoveryDecision = {
  fixable: boolean;
  strategy: RecoveryStrategy;
  confidence: number;
  estimatedTime: number;
  reason?: string;
};

/**
 * RecoveryEngine: Determine if an error is fixable and select recovery strategy.
 */
export class RecoveryEngine {
  /**
   * Determine if recovery should be attempted for this error.
   */
  shouldAttemptRecovery(error: ParsedError): RecoveryDecision {
    // Analyze error type
    const errorType = this.classifyError(error);

    switch (errorType) {
      case "type-error":
      case "syntax-error":
      case "import-error":
        return {
          fixable: true,
          strategy: "spawn-agent",
          confidence: 0.8,
          estimatedTime: 120000, // 2 minutes
          reason: `${errorType} is typically fixable with code changes`,
        };

      case "missing-dependency":
        return {
          fixable: true,
          strategy: "auto-fix",
          confidence: 0.9,
          estimatedTime: 30000, // 30 seconds
          reason: "Missing dependency can be fixed with npm install",
        };

      case "simple-type-mismatch":
        return {
          fixable: true,
          strategy: "auto-fix",
          confidence: 0.7,
          estimatedTime: 60000, // 1 minute
          reason: "Simple type mismatch may be auto-fixable",
        };

      case "permission-error":
      case "missing-file":
      case "infrastructure-error":
        return {
          fixable: false,
          strategy: "escalate",
          confidence: 1.0,
          estimatedTime: 0,
          reason: `${errorType} requires manual intervention`,
        };

      case "complex-logic-error":
      case "refactoring-needed":
        return {
          fixable: true,
          strategy: "spawn-agent",
          confidence: 0.6,
          estimatedTime: 300000, // 5 minutes
          reason: `${errorType} requires agent analysis and fix`,
        };

      default:
        return {
          fixable: true,
          strategy: "spawn-agent",
          confidence: 0.5,
          estimatedTime: 180000, // 3 minutes
          reason: "Unknown error type, attempting agent fix",
        };
    }
  }

  /**
   * Classify error type based on code and message.
   */
  private classifyError(error: ParsedError): string {
    const code = error.code.toUpperCase();
    const message = error.message.toLowerCase();

    // Type errors
    if (code.startsWith("TS23") || code.startsWith("TS24") || code.startsWith("TS25")) {
      if (message.includes("not assignable") || message.includes("type")) {
        if (message.includes("missing") || message.includes("undefined")) {
          return "missing-dependency";
        }
        if (message.split(" ").length < 10) {
          return "simple-type-mismatch";
        }
        return "type-error";
      }
    }

    // Syntax errors
    if (code.startsWith("TS10") || message.includes("syntax") || message.includes("parse")) {
      return "syntax-error";
    }

    // Import errors / Missing dependencies
    if (
      message.includes("cannot find module") ||
      message.includes("module not found") ||
      (code.startsWith("TS23") && message.includes("import"))
    ) {
      // Check if it's a missing dependency (can be auto-fixed with npm install)
      if (message.includes("cannot find module") || message.includes("module not found")) {
        return "missing-dependency";
      }
      return "import-error";
    }

    // Permission errors
    if (
      message.includes("permission") ||
      message.includes("eacces") ||
      message.includes("access denied")
    ) {
      return "permission-error";
    }

    // Missing file errors
    if (
      message.includes("cannot find") &&
      message.includes("file") &&
      !message.includes("module")
    ) {
      return "missing-file";
    }

    // Infrastructure errors
    if (
      message.includes("build failed") ||
      message.includes("compilation failed") ||
      code === "BUILD_FAILED"
    ) {
      // Check if it's a complex error
      if (error.context.split("\n").length > 20) {
        return "complex-logic-error";
      }
      return "infrastructure-error";
    }

    // Complex logic errors (long context, multiple files)
    if (error.context.split("\n").length > 30 || message.split(" ").length > 15) {
      return "complex-logic-error";
    }

    // Refactoring needed (mentions of architecture, design, structure)
    if (
      message.includes("refactor") ||
      message.includes("architecture") ||
      message.includes("design")
    ) {
      return "refactoring-needed";
    }

    return "unknown";
  }

  /**
   * Select recovery strategy based on error classification.
   */
  selectStrategy(error: ParsedError): RecoveryStrategy {
    const decision = this.shouldAttemptRecovery(error);
    return decision.strategy;
  }
}
