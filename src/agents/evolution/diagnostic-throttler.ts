/**
 * Diagnostic Agent Throttler
 *
 * Prevents excessive diagnostic agent spawning by:
 * - Rate limiting (max per hour)
 * - Concurrent limiting (max at once)
 * - Throttling (minimum delay between spawns)
 * - Validation (check for false positives before spawning)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { log } from "../pi-embedded-runner/logger.js";

export type DiagnosticThrottleConfig = {
  maxPerHour?: number;
  maxConcurrent?: number;
  minDelayBetweenMs?: number;
  /** Exponential backoff multiplier for repeated failures on same tool */
  backoffMultiplier?: number;
  timeoutMs?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  maxTimeoutsPerTool?: number;
  timeoutCooldownHours?: number;
};

const DEFAULT_CONFIG: Required<DiagnosticThrottleConfig> = {
  maxPerHour: 3,
  maxConcurrent: 1,
  minDelayBetweenMs: 300_000, // 5 minutes
  backoffMultiplier: 2.0,
  timeoutMs: 120_000, // 2 minutes
  thinkingLevel: "minimal",
  maxTimeoutsPerTool: 2,
  timeoutCooldownHours: 1,
};

type DiagnosticSpawnRecord = {
  timestamp: number;
  toolName: string;
  sessionKey: string;
  completed?: boolean;
  rateLimitError?: boolean;
  timedOut?: boolean;
};

export class DiagnosticThrottler {
  private readonly config: Required<DiagnosticThrottleConfig>;
  private readonly toolBackoff: Map<string, number> = new Map();
  private readonly stateFile: string;
  private activeSpawns: Map<string, DiagnosticSpawnRecord> = new Map();
  private lastSpawnTime: number = 0;

  constructor(config?: DiagnosticThrottleConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const stateDir = path.join(resolveStateDir(), "evolution");
    this.stateFile = path.join(stateDir, "diagnostic-throttle-state.json");
  }

  /**
   * Check for rate limit errors in recent history.
   * Returns whether we should wait due to rate limiting.
   */
  async checkRateLimit(): Promise<{ canProceed: boolean; waitUntil?: number; reason?: string }> {
    const history = await this.loadHistory();
    const oneHourAgo = Date.now() - 3600_000;

    // Check for recent rate limit errors
    const recentRateLimitErrors = history.filter(
      (r) => r.rateLimitError && r.timestamp > oneHourAgo,
    );

    if (recentRateLimitErrors.length > 0) {
      // If we hit rate limit recently, wait 1 hour from the last error
      const lastError = Math.max(...recentRateLimitErrors.map((r) => r.timestamp));
      const waitUntil = lastError + 3600_000;
      const waitMinutes = Math.ceil((waitUntil - Date.now()) / 60_000);

      if (Date.now() < waitUntil) {
        return {
          canProceed: false,
          waitUntil,
          reason: `Rate limit detected in last hour, wait ${waitMinutes} minutes`,
        };
      }
    }

    return { canProceed: true };
  }

  /**
   * Get the current backoff delay for a tool based on failure history.
   * Resets after a successful diagnostic.
   */
  getToolBackoffMs(toolName: string): number {
    const factor = this.toolBackoff.get(toolName) ?? 1;
    return this.config.minDelayBetweenMs * factor;
  }

  /**
   * Record a diagnostic outcome for backoff adjustment.
   */
  recordDiagnosticOutcome(toolName: string, success: boolean): void {
    const current = this.toolBackoff.get(toolName) ?? 1;
    const next = success ? 1 : Math.min(current * this.config.backoffMultiplier, 8);
    this.toolBackoff.set(toolName, next);
  }

  /**
   * Check if a tool has timed out too many times recently.
   */
  async checkTimeoutCooldown(toolName: string): Promise<{ allowed: boolean; reason?: string }> {
    const history = await this.loadHistory();
    const cooldownMs = this.config.timeoutCooldownHours * 3600_000;
    const cooldownAgo = Date.now() - cooldownMs;

    // Count timeouts for this tool in the cooldown window
    const recentTimeouts = history.filter(
      (r) => r.toolName === toolName && r.timedOut && r.timestamp > cooldownAgo,
    );

    if (recentTimeouts.length >= this.config.maxTimeoutsPerTool) {
      const lastTimeout = Math.max(...recentTimeouts.map((r) => r.timestamp));
      const waitUntil = lastTimeout + cooldownMs;
      const waitMinutes = Math.ceil((waitUntil - Date.now()) / 60_000);

      if (Date.now() < waitUntil) {
        return {
          allowed: false,
          reason: `Tool ${toolName} timed out ${recentTimeouts.length} times, cooldown for ${waitMinutes} minutes`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check if we can spawn a diagnostic agent for a tool.
   * Returns { allowed: true } if allowed, or { allowed: false, reason: string } if throttled.
   */
  async canSpawn(toolName: string): Promise<{ allowed: boolean; reason?: string }> {
    // Check rate limit first
    const rateLimitCheck = await this.checkRateLimit();
    if (!rateLimitCheck.canProceed) {
      return {
        allowed: false,
        reason: rateLimitCheck.reason ?? "Rate limit detected",
      };
    }

    // Check timeout cooldown
    const timeoutCheck = await this.checkTimeoutCooldown(toolName);
    if (!timeoutCheck.allowed) {
      return timeoutCheck;
    }

    // Load spawn history
    const history = await this.loadHistory();

    // Check concurrent limit
    const activeCount = Array.from(this.activeSpawns.values()).filter((r) => !r.completed).length;
    if (activeCount >= this.config.maxConcurrent) {
      return {
        allowed: false,
        reason: `Maximum concurrent diagnostic agents (${this.config.maxConcurrent}) reached`,
      };
    }

    // Check rate limit (max per hour)
    const oneHourAgo = Date.now() - 3600_000;
    const recentSpawns = history.filter((r) => r.timestamp > oneHourAgo);
    if (recentSpawns.length >= this.config.maxPerHour) {
      const oldestRecent = Math.min(...recentSpawns.map((r) => r.timestamp));
      const waitUntil = oldestRecent + 3600_000;
      const waitMinutes = Math.ceil((waitUntil - Date.now()) / 60_000);
      return {
        allowed: false,
        reason: `Rate limit: ${this.config.maxPerHour} diagnostic agents per hour (wait ${waitMinutes} minutes)`,
      };
    }

    // Check throttling (minimum delay between spawns)
    const timeSinceLastSpawn = Date.now() - this.lastSpawnTime;
    if (timeSinceLastSpawn < this.config.minDelayBetweenMs) {
      const waitMs = this.config.minDelayBetweenMs - timeSinceLastSpawn;
      const waitMinutes = Math.ceil(waitMs / 60_000);
      return {
        allowed: false,
        reason: `Throttled: minimum ${Math.ceil(this.config.minDelayBetweenMs / 60_000)} minutes between spawns (wait ${waitMinutes} minutes)`,
      };
    }

    // Check if we recently spawned for this tool (avoid duplicates)
    const recentForTool = history.filter(
      (r) => r.toolName === toolName && r.timestamp > oneHourAgo,
    );
    if (recentForTool.length > 0) {
      return {
        allowed: false,
        reason: `Already spawned diagnostic agent for ${toolName} in the last hour`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record that a diagnostic agent is being spawned.
   */
  async recordSpawn(toolName: string, sessionKey: string): Promise<void> {
    const record: DiagnosticSpawnRecord = {
      timestamp: Date.now(),
      toolName,
      sessionKey,
      completed: false,
    };

    this.activeSpawns.set(sessionKey, record);
    this.lastSpawnTime = Date.now();

    // Persist to disk
    const history = await this.loadHistory();
    history.push(record);
    // Keep only last 24 hours
    const oneDayAgo = Date.now() - 86400_000;
    const filtered = history.filter((r) => r.timestamp > oneDayAgo);
    await this.saveHistory(filtered);
  }

  /**
   * Mark a diagnostic agent as completed.
   */
  async recordCompletion(sessionKey: string, options?: { timedOut?: boolean }): Promise<void> {
    const record = this.activeSpawns.get(sessionKey);
    if (record) {
      record.completed = true;
      if (options?.timedOut) {
        record.timedOut = true;
      }
      const history = await this.loadHistory();
      const index = history.findIndex((r) => r.sessionKey === sessionKey);
      if (index >= 0) {
        history[index].completed = true;
        if (options?.timedOut) {
          history[index].timedOut = true;
        }
        await this.saveHistory(history);
      }
    }
  }

  /**
   * Record a rate limit error.
   */
  async recordRateLimitError(toolName: string, sessionKey: string): Promise<void> {
    const record = this.activeSpawns.get(sessionKey);
    if (record) {
      record.rateLimitError = true;
    }
    const history = await this.loadHistory();
    const index = history.findIndex((r) => r.sessionKey === sessionKey);
    if (index >= 0) {
      history[index].rateLimitError = true;
      await this.saveHistory(history);
    } else {
      // Create new record if not found
      const newRecord: DiagnosticSpawnRecord = {
        timestamp: Date.now(),
        toolName,
        sessionKey,
        completed: true,
        rateLimitError: true,
      };
      history.push(newRecord);
      await this.saveHistory(history);
    }
  }

  /**
   * Get configuration for diagnostic agent (timeout, thinking level).
   */
  getConfig(): { timeout: number; thinkingLevel: string } {
    return {
      timeout: this.config.timeoutMs / 1000, // Convert to seconds
      thinkingLevel: this.config.thinkingLevel,
    };
  }

  /**
   * Load spawn history from disk.
   */
  private async loadHistory(): Promise<DiagnosticSpawnRecord[]> {
    try {
      const content = await fs.readFile(this.stateFile, "utf-8");
      return JSON.parse(content) as DiagnosticSpawnRecord[];
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") {
        return [];
      }
      log.warn(`[diagnostic-throttler] Failed to load history: ${err}`);
      return [];
    }
  }

  /**
   * Save spawn history to disk.
   */
  private async saveHistory(history: DiagnosticSpawnRecord[]): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
      await fs.writeFile(this.stateFile, JSON.stringify(history, null, 2), "utf-8");
    } catch (err) {
      log.warn(`[diagnostic-throttler] Failed to save history: ${err}`);
    }
  }

  /**
   * Clean up old completed spawns from memory.
   */
  async cleanup(): Promise<void> {
    const oneHourAgo = Date.now() - 3600_000;
    for (const [key, record] of this.activeSpawns.entries()) {
      if (record.completed && record.timestamp < oneHourAgo) {
        this.activeSpawns.delete(key);
      }
    }
  }
}

/**
 * Global throttler instance.
 */
let globalThrottler: DiagnosticThrottler | null = null;

export function getDiagnosticThrottler(config?: DiagnosticThrottleConfig): DiagnosticThrottler {
  if (!globalThrottler) {
    globalThrottler = new DiagnosticThrottler(config);
  }
  return globalThrottler;
}
