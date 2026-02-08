/**
 * Role-Based Safety System
 *
 * Training-free safety alignment via role assignment.
 * Each role has built-in capability bounds and constraints.
 *
 * Key insight: Don't fine-tune for safety. Instead, assign roles
 * that have safety built-in, then route tasks appropriately.
 *
 * Research basis: "Training-Free Safety Alignment" - research papers 2025-2026
 */

/**
 * Safety Role Definition
 */
export type SafetyRole = "executor" | "analyst" | "planner" | "validator" | "observer";

export interface RoleCapabilities {
  canExecuteTools: boolean;
  canModifyFiles: boolean;
  canAcceptUserInput: boolean;
  canMakeDecisions: boolean;
  canCreateResources: boolean;
  maxConcurrency: number;
  maxTokensPerCall: number;
  maxToolCallsPerSession: number;
}

export interface RoleConstraints {
  forbiddenTools: string[];
  forbiddenPatterns: RegExp[];
  requiredValidation: string[]; // Must validate with these roles before acting
  auditRequired: boolean;
  riskLevel: "safe" | "moderate" | "high";
}

export interface SafetyRoleConfig {
  role: SafetyRole;
  description: string;
  capabilities: RoleCapabilities;
  constraints: RoleConstraints;
  trustLevel: number; // 0.0 - 1.0: How much to trust this role's decisions
}

/**
 * Role Definitions with Built-in Safety
 */
export const SAFETY_ROLES: Record<SafetyRole, SafetyRoleConfig> = {
  executor: {
    role: "executor",
    description: "Executes pre-validated tasks. Highest capability, requires validation.",
    capabilities: {
      canExecuteTools: true,
      canModifyFiles: true,
      canAcceptUserInput: true,
      canMakeDecisions: true,
      canCreateResources: true,
      maxConcurrency: 10,
      maxTokensPerCall: 100000,
      maxToolCallsPerSession: 500,
    },
    constraints: {
      forbiddenTools: ["rm -rf", "format", "mkfs"], // Destructive operations
      forbiddenPatterns: [/sudo/, /admin/, /password/i],
      requiredValidation: ["validator"], // Must validate before executing
      auditRequired: true,
      riskLevel: "high",
    },
    trustLevel: 0.8,
  },

  analyst: {
    role: "analyst",
    description: "Analyzes data, reads files, performs research. No modification.",
    capabilities: {
      canExecuteTools: true, // Can run read-only tools
      canModifyFiles: false,
      canAcceptUserInput: true,
      canMakeDecisions: false,
      canCreateResources: false,
      maxConcurrency: 5,
      maxTokensPerCall: 50000,
      maxToolCallsPerSession: 200,
    },
    constraints: {
      forbiddenTools: ["write", "edit", "exec", "delete"],
      forbiddenPatterns: [/write|delete|modify|mutate/i],
      requiredValidation: [],
      auditRequired: false,
      riskLevel: "safe",
    },
    trustLevel: 0.95,
  },

  planner: {
    role: "planner",
    description: "Creates plans and strategies. Makes decisions but doesn't execute.",
    capabilities: {
      canExecuteTools: false,
      canModifyFiles: false,
      canAcceptUserInput: true,
      canMakeDecisions: true,
      canCreateResources: false,
      maxConcurrency: 3,
      maxTokensPerCall: 50000,
      maxToolCallsPerSession: 50, // Minimal tool use
    },
    constraints: {
      forbiddenTools: ["exec", "write", "edit", "delete", "web_search"],
      forbiddenPatterns: [/execute|run|perform/i],
      requiredValidation: [],
      auditRequired: false,
      riskLevel: "safe",
    },
    trustLevel: 0.9,
  },

  validator: {
    role: "validator",
    description: "Validates decisions and outputs. Checks safety constraints.",
    capabilities: {
      canExecuteTools: true, // Can run validation tools
      canModifyFiles: false,
      canAcceptUserInput: false,
      canMakeDecisions: true, // Can approve/reject
      canCreateResources: false,
      maxConcurrency: 1,
      maxTokensPerCall: 30000,
      maxToolCallsPerSession: 100,
    },
    constraints: {
      forbiddenTools: ["exec", "write", "delete"],
      forbiddenPatterns: [/execute|create|modify/i],
      requiredValidation: [],
      auditRequired: true,
      riskLevel: "safe",
    },
    trustLevel: 0.99, // Validators are highly trusted
  },

  observer: {
    role: "observer",
    description: "Observes and logs. Read-only, passive mode.",
    capabilities: {
      canExecuteTools: false,
      canModifyFiles: false,
      canAcceptUserInput: false,
      canMakeDecisions: false,
      canCreateResources: false,
      maxConcurrency: 0,
      maxTokensPerCall: 10000,
      maxToolCallsPerSession: 0,
    },
    constraints: {
      forbiddenTools: ["all"],
      forbiddenPatterns: [/.*/], // No actions allowed
      requiredValidation: [],
      auditRequired: false,
      riskLevel: "safe",
    },
    trustLevel: 1.0, // Perfect - can't do anything
  },
};

/**
 * Safety Evaluator
 * Checks if an action is safe given the current role
 */
export function evaluateSafety(
  role: SafetyRole,
  toolName: string,
  action: string,
): { safe: boolean; reason: string; trustLevel: number } {
  const roleConfig = SAFETY_ROLES[role];

  // Check if tool is forbidden
  if (roleConfig.constraints.forbiddenTools.includes(toolName)) {
    return {
      safe: false,
      reason: `Role "${role}" is not allowed to use tool "${toolName}"`,
      trustLevel: 0,
    };
  }

  // Check if action matches forbidden patterns
  for (const pattern of roleConfig.constraints.forbiddenPatterns) {
    if (pattern.test(action)) {
      return {
        safe: false,
        reason: `Action matches forbidden pattern for role "${role}": ${pattern}`,
        trustLevel: 0,
      };
    }
  }

  // Check if capability is enabled
  if (toolName === "exec" && !roleConfig.capabilities.canExecuteTools) {
    return {
      safe: false,
      reason: `Role "${role}" cannot execute tools`,
      trustLevel: 0,
    };
  }

  if ((toolName === "write" || toolName === "edit") && !roleConfig.capabilities.canModifyFiles) {
    return {
      safe: false,
      reason: `Role "${role}" cannot modify files`,
      trustLevel: 0,
    };
  }

  // All checks passed
  return {
    safe: true,
    reason: `Action is safe for role "${role}"`,
    trustLevel: roleConfig.trustLevel,
  };
}

/**
 * Route Selection
 * Determines which role should handle a task
 */
export function selectRole(taskType: string): SafetyRole {
  switch (taskType) {
    case "analysis":
    case "research":
    case "diagnosis":
      return "analyst";

    case "planning":
    case "strategy":
    case "design":
      return "planner";

    case "execution":
    case "implementation":
    case "creation":
      return "executor";

    case "validation":
    case "review":
    case "approval":
      return "validator";

    case "monitoring":
    case "logging":
    case "observation":
      return "observer";

    default:
      return "executor"; // Default to highest capability
  }
}

/**
 * Validation Requirements
 * Determines who must validate before action
 */
export function getValidationRequirements(role: SafetyRole, toolName: string): SafetyRole[] {
  const config = SAFETY_ROLES[role];
  const requirements: SafetyRole[] = [...config.constraints.requiredValidation] as SafetyRole[];

  // Add automatic validation for high-risk operations
  if (["exec", "write", "delete"].includes(toolName)) {
    if (!requirements.includes("validator")) {
      requirements.push("validator");
    }
  }

  return requirements;
}

/**
 * Example: Execution Flow with Role-Based Safety
 *
 * 1. Task comes in: "Create a backup of the database"
 * 2. Select role: "executor" (task requires creation)
 * 3. Check validation requirements: ["validator"]
 * 4. Request validator approval
 * 5. Validator checks: pattern matching, risk assessment
 * 6. If approved: Execute with executor role
 * 7. If denied: Log denial and suggest alternative
 * 8. Audit: Log all high-risk actions
 */

export interface SafetyCheckResult {
  approved: boolean;
  role: SafetyRole;
  validationsPassed: string[];
  validationsFailed: string[];
  trustScore: number;
  recommendations: string[];
}

/**
 * Main Safety Check Function
 */
export async function checkSafety(
  taskType: string,
  toolName: string,
  action: string,
): Promise<SafetyCheckResult> {
  const selectedRole = selectRole(taskType);
  const evaluation = evaluateSafety(selectedRole, toolName, action);
  const validationRequirements = getValidationRequirements(selectedRole, toolName);

  return {
    approved: evaluation.safe,
    role: selectedRole,
    validationsPassed: evaluation.safe ? validationRequirements : [],
    validationsFailed: evaluation.safe ? [] : [evaluation.reason],
    trustScore: evaluation.trustLevel,
    recommendations: evaluation.safe
      ? ["Action approved. Proceed with execution."]
      : [
          "Action denied by safety system.",
          `Suggestion: Try with role "${findAlternativeRole(toolName)}"`,
        ],
  };
}

/**
 * Find Alternative Role
 * If current role can't perform action, suggest a role that can
 */
function findAlternativeRole(toolName: string): SafetyRole {
  for (const [role, config] of Object.entries(SAFETY_ROLES)) {
    if (!config.constraints.forbiddenTools.includes(toolName)) {
      return role as SafetyRole;
    }
  }
  return "executor"; // Fallback
}

/**
 * Role-Based Task Dispatcher
 * Routes tasks to appropriate roles
 */
export class RoleDispatcher {
  private roleHistory: Map<SafetyRole, number> = new Map();

  dispatch(
    taskType: string,
    action: string,
    toolName: string,
  ): { role: SafetyRole; approved: boolean } {
    const role = selectRole(taskType);
    const safety = evaluateSafety(role, toolName, action);

    // Track role usage for audit
    this.roleHistory.set(role, (this.roleHistory.get(role) || 0) + 1);

    return {
      role,
      approved: safety.safe,
    };
  }

  getAuditLog(): Record<string, number> {
    const result: Record<string, number> = {};
    this.roleHistory.forEach((count, role) => {
      result[role] = count;
    });
    return result;
  }
}

export default {
  SAFETY_ROLES,
  evaluateSafety,
  selectRole,
  checkSafety,
  getValidationRequirements,
  RoleDispatcher,
};
