/**
 * Role-Based Safety Alignment System
 * Training-free safety by assigning roles with built-in constraints and capability bounds.
 *
 * This system prevents capability misuse without requiring fine-tuning by:
 * 1. Defining distinct agent roles with specific capabilities
 * 2. Enforcing safety constraints per role
 * 3. Routing tasks to appropriate roles
 * 4. Validating outputs against role constraints
 */

export interface Tool {
  name: string;
  description: string;
  parameters?: any;
}

export interface SafetyConstraint {
  type:
    | "file_access"
    | "exec_commands"
    | "network_access"
    | "system_modification"
    | "data_sensitivity"
    | "output_validation";
  description: string;
  validator: (action: any, context: TaskContext) => ValidationResult;
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  suggestedRole?: AgentRole;
  modifiedAction?: any;
}

export interface TaskContext {
  taskType: string;
  inputData: any;
  requestedTools: string[];
  riskLevel: "low" | "medium" | "high";
  userPermissions?: string[];
}

export interface RoleCapabilities {
  allowedTools: string[];
  prohibitedTools: string[];
  fileSystemAccess: "none" | "read-only" | "limited-write" | "full";
  networkAccess: boolean;
  systemModification: boolean;
  maxComplexity: number;
  requiresValidation: boolean;
}

export interface AgentRole {
  name: string;
  description: string;
  capabilities: RoleCapabilities;
  constraints: SafetyConstraint[];
  routingCriteria: (task: TaskContext) => number; // 0-1 score for task suitability
}

/**
 * Core role definitions with built-in safety constraints
 */
export class RoleDefinitions {
  static readonly EXECUTOR: AgentRole = {
    name: "executor",
    description: "Executes well-defined, low-risk tasks with limited system access",
    capabilities: {
      allowedTools: ["Read", "Write", "exec"],
      prohibitedTools: ["evolution_apply_approved_patch", "rebuild_gateway"],
      fileSystemAccess: "limited-write",
      networkAccess: false,
      systemModification: false,
      maxComplexity: 3,
      requiresValidation: false,
    },
    constraints: [
      {
        type: "file_access",
        description: "Only access files in designated safe directories",
        validator: (action, context) => {
          if (action.tool === "Write" || action.tool === "Read") {
            const path = action.parameters?.file_path || action.parameters?.path;
            if (path && (path.includes("..") || path.startsWith("/") || path.includes("system"))) {
              return {
                allowed: false,
                reason: "File path outside safe boundaries",
                suggestedRole: RoleDefinitions.VALIDATOR,
              };
            }
          }
          return { allowed: true };
        },
      },
      {
        type: "exec_commands",
        description: "Only execute safe, non-destructive commands",
        validator: (action, context) => {
          if (action.tool === "exec") {
            const command = action.parameters?.command || "";
            const dangerousCommands = [
              "rm -rf",
              "sudo",
              "chmod +x",
              "curl",
              "wget",
              "python",
              "node",
            ];
            if (dangerousCommands.some((cmd) => command.includes(cmd))) {
              return {
                allowed: false,
                reason: "Potentially dangerous command",
                suggestedRole: RoleDefinitions.VALIDATOR,
              };
            }
          }
          return { allowed: true };
        },
      },
    ],
    routingCriteria: (task) => {
      if (task.riskLevel === "low" && task.taskType.includes("file_ops")) return 0.9;
      if (task.taskType.includes("simple_execution")) return 0.8;
      return 0.2;
    },
  };

  static readonly ANALYST: AgentRole = {
    name: "analyst",
    description: "Analyzes data and provides insights with read-only access",
    capabilities: {
      allowedTools: ["Read", "episodic_recall", "semantic_query", "web_search", "web_fetch"],
      prohibitedTools: ["Write", "exec", "Edit", "evolution_apply_approved_patch"],
      fileSystemAccess: "read-only",
      networkAccess: true,
      systemModification: false,
      maxComplexity: 7,
      requiresValidation: true,
    },
    constraints: [
      {
        type: "data_sensitivity",
        description: "Cannot access sensitive system files or credentials",
        validator: (action, context) => {
          if (action.tool === "Read") {
            const path = action.parameters?.file_path || action.parameters?.path;
            if (
              path &&
              (path.includes("secret") ||
                path.includes("password") ||
                path.includes("key") ||
                path.includes(".env"))
            ) {
              return { allowed: false, reason: "Attempting to access sensitive data" };
            }
          }
          return { allowed: true };
        },
      },
      {
        type: "output_validation",
        description: "Validate analysis outputs for bias and accuracy",
        validator: (action, context) => {
          // This would include logic to check for biased language, misinformation, etc.
          return { allowed: true };
        },
      },
    ],
    routingCriteria: (task) => {
      if (task.taskType.includes("analysis") || task.taskType.includes("research")) return 0.9;
      if (task.taskType.includes("data_review")) return 0.8;
      return 0.3;
    },
  };

  static readonly PLANNER: AgentRole = {
    name: "planner",
    description: "Creates plans and strategies without execution capabilities",
    capabilities: {
      allowedTools: [
        "Read",
        "goal_push",
        "goal_status",
        "episodic_recall",
        "semantic_query",
        "meta_learning",
      ],
      prohibitedTools: ["exec", "Write", "Edit", "evolution_apply_approved_patch"],
      fileSystemAccess: "read-only",
      networkAccess: false,
      systemModification: false,
      maxComplexity: 8,
      requiresValidation: true,
    },
    constraints: [
      {
        type: "system_modification",
        description: "Cannot modify system state, only create plans",
        validator: (action, context) => {
          if (["Write", "Edit", "exec"].includes(action.tool)) {
            return {
              allowed: false,
              reason: "Planner role cannot modify system state",
              suggestedRole: RoleDefinitions.VALIDATOR,
            };
          }
          return { allowed: true };
        },
      },
    ],
    routingCriteria: (task) => {
      if (task.taskType.includes("planning") || task.taskType.includes("strategy")) return 0.9;
      if (task.taskType.includes("goal_setting")) return 0.8;
      return 0.2;
    },
  };

  static readonly VALIDATOR: AgentRole = {
    name: "validator",
    description: "Reviews and validates high-risk operations with full system access",
    capabilities: {
      allowedTools: [
        "Read",
        "Write",
        "exec",
        "Edit",
        "evolution_propose_patch",
        "evolution_run_dojo_test",
      ],
      prohibitedTools: ["evolution_apply_approved_patch"], // Requires explicit human approval
      fileSystemAccess: "full",
      networkAccess: true,
      systemModification: true,
      maxComplexity: 10,
      requiresValidation: true,
    },
    constraints: [
      {
        type: "system_modification",
        description: "All system modifications must be logged and reviewed",
        validator: (action, context) => {
          if (["evolution_apply_approved_patch", "rebuild_gateway"].includes(action.tool)) {
            // These require human approval or additional validation
            return {
              allowed: false,
              reason: "High-risk system modification requires human approval",
            };
          }
          return { allowed: true };
        },
      },
    ],
    routingCriteria: (task) => {
      if (task.riskLevel === "high") return 0.9;
      if (task.taskType.includes("system_modification") || task.taskType.includes("validation"))
        return 0.8;
      return 0.1;
    },
  };

  static getAllRoles(): AgentRole[] {
    return [this.EXECUTOR, this.ANALYST, this.PLANNER, this.VALIDATOR];
  }
}

/**
 * Main role-based safety system
 */
export class RoleBasedSafetySystem {
  private roles: Map<string, AgentRole>;
  private currentRole: AgentRole;
  private actionLog: Array<{
    role: string;
    action: any;
    timestamp: number;
    result: ValidationResult;
  }>;

  constructor() {
    this.roles = new Map();
    RoleDefinitions.getAllRoles().forEach((role) => {
      this.roles.set(role.name, role);
    });
    this.currentRole = RoleDefinitions.EXECUTOR; // Default to safest role
    this.actionLog = [];
  }

  /**
   * Route a task to the most appropriate role
   */
  routeTask(task: TaskContext): AgentRole {
    let bestRole = this.currentRole;
    let bestScore = 0;

    for (const role of this.roles.values()) {
      const score = role.routingCriteria(task);
      if (score > bestScore) {
        bestScore = score;
        bestRole = role;
      }
    }

    console.log(
      `[RoleSafety] Routing task type "${task.taskType}" to role "${bestRole.name}" (score: ${bestScore})`,
    );
    return bestRole;
  }

  /**
   * Switch to a specific role with safety checks
   */
  switchRole(roleName: string, task?: TaskContext): boolean {
    const role = this.roles.get(roleName);
    if (!role) {
      console.error(`[RoleSafety] Unknown role: ${roleName}`);
      return false;
    }

    // Additional safety check: ensure the role switch is appropriate
    if (task) {
      const routedRole = this.routeTask(task);
      if (
        routedRole.name !== roleName &&
        routedRole.capabilities.maxComplexity > role.capabilities.maxComplexity
      ) {
        console.warn(
          `[RoleSafety] Role switch to "${roleName}" may be inappropriate for task complexity`,
        );
      }
    }

    this.currentRole = role;
    console.log(`[RoleSafety] Switched to role: ${role.name}`);
    return true;
  }

  /**
   * Validate an action against the current role's constraints
   */
  validateAction(
    action: { tool: string; parameters?: any },
    context: TaskContext,
  ): ValidationResult {
    const role = this.currentRole;

    // Check if tool is allowed
    if (role.capabilities.prohibitedTools.includes(action.tool)) {
      return {
        allowed: false,
        reason: `Tool "${action.tool}" is prohibited for role "${role.name}"`,
        suggestedRole: this.findRoleForTool(action.tool),
      };
    }

    if (
      role.capabilities.allowedTools.length > 0 &&
      !role.capabilities.allowedTools.includes(action.tool)
    ) {
      return {
        allowed: false,
        reason: `Tool "${action.tool}" is not in allowed tools for role "${role.name}"`,
        suggestedRole: this.findRoleForTool(action.tool),
      };
    }

    // Run role-specific constraint validators
    for (const constraint of role.constraints) {
      const result = constraint.validator(action, context);
      if (!result.allowed) {
        this.logAction(action, result);
        return result;
      }
    }

    const result = { allowed: true };
    this.logAction(action, result);
    return result;
  }

  /**
   * Find the most appropriate role for a given tool
   */
  private findRoleForTool(toolName: string): AgentRole | undefined {
    for (const role of this.roles.values()) {
      if (
        role.capabilities.allowedTools.includes(toolName) &&
        !role.capabilities.prohibitedTools.includes(toolName)
      ) {
        return role;
      }
    }
    return undefined;
  }

  /**
   * Log action for audit trail
   */
  private logAction(action: any, result: ValidationResult): void {
    this.actionLog.push({
      role: this.currentRole.name,
      action,
      timestamp: Date.now(),
      result,
    });

    // Keep only last 1000 actions to prevent memory bloat
    if (this.actionLog.length > 1000) {
      this.actionLog = this.actionLog.slice(-1000);
    }
  }

  /**
   * Get current role information
   */
  getCurrentRole(): AgentRole {
    return this.currentRole;
  }

  /**
   * Get action audit log
   */
  getAuditLog(
    limit = 100,
  ): Array<{ role: string; action: any; timestamp: number; result: ValidationResult }> {
    return this.actionLog.slice(-limit);
  }

  /**
   * Check if current role can perform a specific task type
   */
  canPerformTask(taskType: string, riskLevel: "low" | "medium" | "high" = "medium"): boolean {
    const task: TaskContext = {
      taskType,
      inputData: {},
      requestedTools: [],
      riskLevel,
    };

    const routedRole = this.routeTask(task);
    return routedRole.name === this.currentRole.name;
  }

  /**
   * Get safety report for current configuration
   */
  getSafetyReport(): any {
    const recent = this.getAuditLog(50);
    const blocked = recent.filter((entry) => !entry.result.allowed);
    const toolUsage = recent.reduce(
      (acc, entry) => {
        const tool = entry.action.tool;
        acc[tool] = (acc[tool] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      currentRole: this.currentRole.name,
      roleCapabilities: this.currentRole.capabilities,
      recentActions: recent.length,
      blockedActions: blocked.length,
      blockRate: recent.length > 0 ? blocked.length / recent.length : 0,
      toolUsage,
      commonBlockReasons: blocked
        .map((b) => b.result.reason)
        .reduce(
          (acc, reason) => {
            if (reason) acc[reason] = (acc[reason] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        ),
    };
  }

  /**
   * Get a role by name (for research-integration compatibility)
   */
  getRole(roleName?: string): AgentRole {
    if (roleName) {
      const role = this.roles.get(roleName);
      if (role) return role;
    }
    return this.currentRole;
  }

  /**
   * Validate tool usage for a specific role (for research-integration compatibility)
   */
  validateToolUsage(
    roleName: string,
    toolName: string,
    parameters: any,
    context: TaskContext,
  ): ValidationResult {
    const role = this.roles.get(roleName);
    if (!role) {
      return { allowed: false, reason: `Unknown role: ${roleName}` };
    }

    // Temporarily switch to the role for validation
    const prevRole = this.currentRole;
    this.currentRole = role;

    const result = this.validateAction({ tool: toolName, parameters }, context);

    // Restore previous role
    this.currentRole = prevRole;
    return result;
  }
}

/**
 * Integration wrapper for existing tools
 */
export class SafeToolProxy {
  constructor(private safetySystem: RoleBasedSafetySystem) {}

  /**
   * Safely execute a tool with role-based validation
   */
  async executeTool(toolName: string, parameters: any, context: TaskContext): Promise<any> {
    const action = { tool: toolName, parameters };
    const validation = this.safetySystem.validateAction(action, context);

    if (!validation.allowed) {
      if (validation.suggestedRole) {
        console.warn(
          `[RoleSafety] Action blocked. Suggested role: ${validation.suggestedRole.name}`,
        );
        console.warn(`[RoleSafety] Reason: ${validation.reason}`);

        // Auto-switch to suggested role if it makes sense
        if (this.safetySystem.switchRole(validation.suggestedRole.name, context)) {
          console.log(
            `[RoleSafety] Auto-switched to ${validation.suggestedRole.name}, retrying action`,
          );
          return this.executeTool(toolName, parameters, context);
        }
      }

      throw new Error(`Action blocked by role safety: ${validation.reason}`);
    }

    if (validation.modifiedAction) {
      console.log(`[RoleSafety] Action modified by safety constraints`);
      parameters = validation.modifiedAction.parameters;
    }

    // Here you would integrate with the actual tool execution system
    // For now, we'll return a mock response
    console.log(
      `[RoleSafety] Executing ${toolName} with role ${this.safetySystem.getCurrentRole().name}`,
    );
    return {
      success: true,
      tool: toolName,
      parameters,
      role: this.safetySystem.getCurrentRole().name,
    };
  }
}

// Export singleton instance for global use
export const roleBasedSafety = new RoleBasedSafetySystem();
export const safeToolProxy = new SafeToolProxy(roleBasedSafety);

/**
 * Utility functions for easy integration
 */
export function withRoleValidation<T>(
  toolFunction: (...args: any[]) => Promise<T>,
  toolName: string,
  context: TaskContext,
) {
  return async (...args: any[]): Promise<T> => {
    const action = { tool: toolName, parameters: args[0] || {} };
    const validation = roleBasedSafety.validateAction(action, context);

    if (!validation.allowed) {
      throw new Error(`Role safety violation: ${validation.reason}`);
    }

    return toolFunction(...args);
  };
}

export function getCurrentRoleInfo() {
  return {
    role: roleBasedSafety.getCurrentRole(),
    safetyReport: roleBasedSafety.getSafetyReport(),
  };
}
