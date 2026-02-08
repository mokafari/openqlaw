/**
 * Research Integration Layer
 * Wires role-safety, test-time-scaling, and share-framework into the main runner
 */

import type { AgentRole, TaskContext, ValidationResult } from "./role-safety.js";
import { RoleBasedSafetySystem } from "./role-safety.js";
import { ShareFramework, TaskType } from "./share-framework.js";
import TestTimeScalingOptimizer from "./test-time-scaling.js";

// Type aliases for compatibility
type ScalingConfig = ConstructorParameters<typeof TestTimeScalingOptimizer>[0];
type TestTimeScaler = TestTimeScalingOptimizer;
type SubspaceRouter = ShareFramework;

export interface ResearchConfig {
  /** Enable role-based safety constraints */
  roleSafety?: {
    enabled: boolean;
    defaultRole?: string;
    strictMode?: boolean;
  };
  /** Enable test-time scaling for complex queries */
  testTimeScaling?: {
    enabled: boolean;
    maxPaths?: number;
    qualityTarget?: number;
    complexityThreshold?: number;
  };
  /** Enable Share Framework subspace routing */
  shareFramework?: {
    enabled: boolean;
    logRouting?: boolean;
  };
}

export interface ResearchContext {
  sessionId?: string;
  taskType?: string;
  complexity?: number;
  requestedTools?: string[];
  userMessage?: string;
}

export interface ResearchResult {
  allowed: boolean;
  role?: AgentRole;
  subspace?: TaskType;
  scalingRecommendation?: "none" | "light" | "aggressive";
  validationErrors?: string[];
  suggestions?: string[];
}

/**
 * Main integration class - singleton per session
 */
export class ResearchIntegration {
  private config: ResearchConfig;
  private roleSafety?: ReturnType<typeof createRoleSafetySystem>;
  private testTimeScaler?: TestTimeScaler;
  private shareRouter?: SubspaceRouter;

  constructor(config: ResearchConfig = {}) {
    this.config = {
      roleSafety: { enabled: true, strictMode: false, ...config.roleSafety },
      testTimeScaling: {
        enabled: true,
        maxPaths: 3,
        qualityTarget: 0.9,
        complexityThreshold: 0.7,
        ...config.testTimeScaling,
      },
      shareFramework: { enabled: true, logRouting: false, ...config.shareFramework },
    };

    // Initialize systems
    if (this.config.roleSafety?.enabled) {
      this.roleSafety = new RoleBasedSafetySystem();
    }

    if (this.config.testTimeScaling?.enabled) {
      const scalingConfig = {
        maxPaths: this.config.testTimeScaling.maxPaths ?? 3,
        minConfidenceThreshold: 0.7,
        verificationDepth: "medium" as const,
        recursionLimit: 2,
        qualityTarget: this.config.testTimeScaling.qualityTarget ?? 0.9,
        computeBudget: 2.0, // 2x inference budget
        enableAdaptiveScaling: true,
      };
      this.testTimeScaler = new TestTimeScalingOptimizer(scalingConfig);
    }

    if (this.config.shareFramework?.enabled) {
      this.shareRouter = new ShareFramework();
      if (this.config.shareFramework.logRouting) {
        console.log("[ShareFramework] Initialized with dynamic routing");
      }
    }
  }

  /**
   * Pre-run validation and routing
   * Called before executing a user request
   */
  async validateAndRoute(context: ResearchContext): Promise<ResearchResult> {
    const result: ResearchResult = {
      allowed: true,
      validationErrors: [],
      suggestions: [],
    };

    // 1. Classify task type (for Share Framework)
    let taskType: TaskType = "general";
    if (context.requestedTools?.some((t) => t.includes("browser"))) {
      taskType = "browser";
    } else if (context.requestedTools?.some((t) => ["read", "write", "edit"].includes(t))) {
      taskType = "file_ops";
    } else if (context.requestedTools?.some((t) => t.includes("message"))) {
      taskType = "communication";
    } else if (context.requestedTools?.some((t) => t.includes("exec"))) {
      taskType = "self_modification";
    } else if (context.requestedTools?.some((t) => t.includes("web_"))) {
      taskType = "api";
    } else if (context.requestedTools?.some((t) => t.includes("nodes"))) {
      taskType = "devices";
    }

    result.subspace = taskType;

    // 2. Share Framework routing (parameter efficiency)
    if (this.shareRouter) {
      try {
        const routing = this.shareRouter.route(taskType, context.userMessage || "");
        if (this.config.shareFramework?.logRouting) {
          console.log(`[ShareFramework] Routed ${taskType} to subspaces:`, routing.activeSubspaces);
        }
      } catch (err) {
        console.warn("[ShareFramework] Routing failed:", err);
      }
    }

    // 3. Role-based safety validation
    if (this.roleSafety && context.requestedTools) {
      // Determine appropriate role based on task
      const roleHint = this.inferRoleFromTask(taskType);
      const role = this.roleSafety.getRole(roleHint);
      result.role = role;

      // Validate each tool against role constraints
      for (const toolName of context.requestedTools) {
        const taskCtx: TaskContext = {
          taskType: taskType,
          inputData: context.userMessage,
          requestedTools: context.requestedTools,
          riskLevel: this.assessRiskLevel(taskType),
        };

        const validation = this.roleSafety.validateToolUsage(role.name, toolName, {}, taskCtx);
        if (!validation.allowed) {
          result.allowed = false;
          result.validationErrors?.push(
            `Tool ${toolName} not allowed for role ${role.name}: ${validation.reason}`,
          );
          if (validation.suggestedRole) {
            result.suggestions?.push(
              `Consider using role ${validation.suggestedRole.name} instead`,
            );
          }
        }
      }
    }

    // 4. Test-Time Scaling recommendation
    if (this.testTimeScaler && context.complexity !== undefined) {
      const threshold = this.config.testTimeScaling?.complexityThreshold ?? 0.7;
      if (context.complexity > threshold) {
        result.scalingRecommendation = "aggressive";
        result.suggestions?.push(
          `Complex task detected (${(context.complexity * 100).toFixed(0)}%). Recommend multi-path reasoning.`,
        );
      } else if (context.complexity > 0.5) {
        result.scalingRecommendation = "light";
      } else {
        result.scalingRecommendation = "none";
      }
    }

    return result;
  }

  /**
   * Infer agent role from task type
   */
  private inferRoleFromTask(taskType: TaskType): string {
    switch (taskType) {
      case "browser":
        return "browser-operator";
      case "file_ops":
        return "filesystem-analyst";
      case "self_modification":
        return "evolution-engineer";
      case "api":
      case "communication":
        return "communicator";
      case "devices":
        return "browser-operator"; // Closest match
      default:
        return "general-assistant";
    }
  }

  /**
   * Assess risk level based on task type
   */
  private assessRiskLevel(taskType: TaskType): "low" | "medium" | "high" {
    switch (taskType) {
      case "self_modification":
        return "high";
      case "file_ops":
      case "devices":
        return "medium";
      default:
        return "low";
    }
  }

  /**
   * Get role capabilities for display/logging
   */
  getRoleInfo(roleName: string) {
    return this.roleSafety?.getRole(roleName);
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return this.config;
  }
}

/**
 * Create a new research integration instance
 */
export function createResearchIntegration(config?: ResearchConfig): ResearchIntegration {
  return new ResearchIntegration(config);
}

/**
 * Shared singleton for the main session
 * (individual sessions can create their own instances)
 */
let globalIntegration: ResearchIntegration | null = null;

export function getGlobalResearchIntegration(): ResearchIntegration {
  if (!globalIntegration) {
    globalIntegration = createResearchIntegration();
  }
  return globalIntegration;
}
