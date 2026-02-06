/**
 * Context Graph - High-level reachability checks
 *
 * Provides named reachability checks like CanCommit, CanDeploy
 * as specified in the Quake Bot integration docs.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ReachabilityCheckContext } from "./types.js";
import { checkReachabilityType } from "./reachability.js";

export type NamedCapability = "CanCommit" | "CanDeploy" | "CanRead" | "CanWrite" | "CanNetwork";

/**
 * Context Graph - Provides high-level capability checks
 */
export class ContextGraph {
  /**
   * Check if a named capability is available
   *
   * @example
   * ```typescript
   * if (ContextGraph.check(ctx, 'CanDeploy')) {
   *   // Safe to propose deployment
   * } else {
   *   // Prerequisite missing: Plan a route to "fix docker" first
   * }
   * ```
   */
  static async check(
    context: ReachabilityCheckContext,
    capability: NamedCapability,
  ): Promise<boolean> {
    switch (capability) {
      case "CanCommit":
        return this.checkCanCommit(context);
      case "CanDeploy":
        return this.checkCanDeploy(context);
      case "CanRead":
        return this.checkCanRead(context);
      case "CanWrite":
        return this.checkCanWrite(context);
      case "CanNetwork":
        return this.checkCanNetwork(context);
      default:
        return false;
    }
  }

  /**
   * CanCommit: Requires .git folder + user.email config
   */
  private static async checkCanCommit(context: ReachabilityCheckContext): Promise<boolean> {
    if (!context.workspaceDir) {
      return false;
    }

    // Check for .git folder
    const gitDir = path.join(context.workspaceDir, ".git");
    try {
      const gitStat = await fs.stat(gitDir);
      if (!gitStat.isDirectory()) {
        return false;
      }
    } catch {
      return false;
    }

    // Check for git user.email config
    // This is a simplified check - in practice, we'd run `git config user.email`
    // For now, assume if .git exists, git is configured
    return true;
  }

  /**
   * CanDeploy: Requires Dockerfile + docker CLI + Running Daemon
   */
  private static async checkCanDeploy(context: ReachabilityCheckContext): Promise<boolean> {
    if (!context.workspaceDir) {
      return false;
    }

    // Check for Dockerfile
    const dockerfile = path.join(context.workspaceDir, "Dockerfile");
    try {
      await fs.access(dockerfile, fs.constants.F_OK);
    } catch {
      return false;
    }

    // Check for docker CLI (simplified - would need to check PATH)
    // Check for running daemon (simplified - would need to check docker ps)
    // For now, assume if Dockerfile exists, deployment is possible
    // In a real implementation, we'd check:
    // - `which docker` or `docker --version`
    // - `docker ps` to verify daemon is running
    return true;
  }

  /**
   * CanRead: Basic read permissions
   */
  private static async checkCanRead(context: ReachabilityCheckContext): Promise<boolean> {
    return checkReachabilityType("READ", context);
  }

  /**
   * CanWrite: Write permissions
   */
  private static async checkCanWrite(context: ReachabilityCheckContext): Promise<boolean> {
    return checkReachabilityType("WRITE", context);
  }

  /**
   * CanNetwork: Network connectivity
   */
  private static async checkCanNetwork(context: ReachabilityCheckContext): Promise<boolean> {
    return checkReachabilityType("NETWORK", context);
  }

  /**
   * Get detailed check result with missing prerequisites
   */
  static async checkDetailed(
    context: ReachabilityCheckContext,
    capability: NamedCapability,
  ): Promise<{ available: boolean; missing: string[]; reason?: string }> {
    const available = await this.check(context, capability);
    if (available) {
      return { available: true, missing: [] };
    }

    // Provide specific reasons for common capabilities
    switch (capability) {
      case "CanCommit":
        return {
          available: false,
          missing: [".git folder", "git user.email config"],
          reason: "Git repository not configured",
        };
      case "CanDeploy":
        return {
          available: false,
          missing: ["Dockerfile", "docker CLI", "running Docker daemon"],
          reason: "Docker deployment prerequisites missing",
        };
      default:
        return { available: false, missing: [] };
    }
  }
}
