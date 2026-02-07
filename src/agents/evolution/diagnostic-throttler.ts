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
  timeoutMs?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
};

const DEFAULT_CONFIG: Required<DiagnosticThrottleConfig> = {
  maxPerHour: 3,
  maxConcurrent: 1,
  minDelayBetweenMs: 300_000, // 5 minutes
  timeoutMs: 120_000, // 2 minutes
  thinkingLevel: "minimal",
};

type DiagnosticSpawnRecord = {
  timestamp: number;
  toolName: string;
  sessionKey: string;
  completed?: boolean;
};

export class DiagnosticThrottler {
  private readonly config: Required<DiagnosticThrottleConfig>;
  private readonly stateFile: string;
  private activeSpawns: Map<string, DiagnosticSpawnRecord> = new Map();
  private lastSpawnTime: number = 0;

  constructor(config?: DiagnosticThrottleConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const stateDir = path.join(resolveStateDir(), "evolution");
    this.stateFile = path.join(stateDir, "diagnostic-throttle-state.json");
  }

  /**
   * Check if we can spawn a diagnostic agent for a tool.
   * Returns { allowed: true } if allowed, or { allowed: false, reason: string } if throttled.
   */
  async canSpawn(toolName: string): Promise<{ allowed: boolean; reason?: string }> {
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
  async recordCompletion(sessionKey: string): Promise<void> {
    const record = this.activeSpawns.get(sessionKey);
    if (record) {
      record.completed = true;
      const history = await this.loadHistory();
      const index = history.findIndex((r) => r.sessionKey === sessionKey);
      if (index >= 0) {
        history[index].completed = true;
        await this.saveHistory(history);
      }
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
