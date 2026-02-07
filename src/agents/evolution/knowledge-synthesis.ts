/**
 * Knowledge Synthesis System
 *
 * Automatically synthesizes raw logs, telemetry, and experiences into structured knowledge.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { log } from "../pi-embedded-runner/logger.js";
import { MetaLearningSystem } from "./meta-learning.js";
import { readSessionStats } from "./telemetry.js";

export type KnowledgeEntry = {
  id: string;
  title: string;
  category: "fact" | "pattern" | "strategy" | "insight" | "lesson";
  content: string;
  sources: string[]; // Session IDs, file paths, etc.
  confidence: number; // 0.0 - 1.0
  createdAt: number;
  updatedAt: number;
  tags: string[];
};

export class KnowledgeSynthesis {
  private readonly knowledgeDir: string;
  private readonly metaLearning: MetaLearningSystem;

  constructor() {
    this.knowledgeDir = join(resolveStateDir(), "evolution", "knowledge");
    this.metaLearning = new MetaLearningSystem();
  }

  /**
   * Synthesize daily knowledge from telemetry and journal entries.
   */
  async synthesizeDaily(date: string = new Date().toISOString().split("T")[0]): Promise<void> {
    log.info(`[knowledge-synthesis] Starting daily synthesis for ${date}`);

    // 1. Read recent session stats
    const recentStats = await readSessionStats({ limit: 100 });
    const todayStats = recentStats.filter((s) => {
      const statDate = new Date(s.timestamp).toISOString().split("T")[0];
      return statDate === date;
    });

    // 2. Read learning journal
    const journalEntries = await this.metaLearning.getRecentJournalEntries(1);
    const todayJournal = journalEntries.find((e) => e.date === date);

    // 3. Analyze patterns
    const patterns = await this.metaLearning.analyzePatterns();

    // 4. Generate knowledge entries
    const entries: KnowledgeEntry[] = [];

    // Extract facts from successful sessions
    for (const stat of todayStats.filter((s) => s.success)) {
      if (stat.toolCalls > 0) {
        entries.push({
          id: `fact-${stat.sessionId}`,
          title: `Successful task completion`,
          category: "fact",
          content: `Task completed successfully with ${stat.toolCalls} tool calls, ${stat.tokenUsage.total} tokens, in ${stat.durationMs}ms.`,
          sources: [stat.sessionId],
          confidence: 0.8,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          tags: ["success", "telemetry"],
        });
      }
    }

    // Extract patterns from recurring failures
    for (const failure of patterns.recurringFailures) {
      entries.push({
        id: `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        title: `Recurring failure pattern`,
        category: "pattern",
        content: failure,
        sources: ["meta-learning-analysis"],
        confidence: 0.7,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ["failure", "pattern"],
      });
    }

    // Extract successful strategies
    for (const strategy of patterns.successfulStrategies) {
      entries.push({
        id: `strategy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        title: `Successful strategy`,
        category: "strategy",
        content: strategy,
        sources: ["meta-learning-analysis"],
        confidence: 0.8,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ["strategy", "success"],
      });
    }

    // Extract insights from journal
    if (todayJournal) {
      for (const insight of todayJournal.insights) {
        entries.push({
          id: `insight-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          title: `Daily insight`,
          category: "insight",
          content: insight,
          sources: [`journal-${date}`],
          confidence: 0.6,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          tags: ["insight", "journal"],
        });
      }
    }

    // 5. Save knowledge entries
    await this.saveKnowledgeEntries(entries);

    log.info(`[knowledge-synthesis] Synthesized ${entries.length} knowledge entries for ${date}`);
  }

  /**
   * Search knowledge entries by query.
   */
  async searchKnowledge(query: string): Promise<KnowledgeEntry[]> {
    const allEntries = await this.loadAllKnowledgeEntries();
    const queryLower = query.toLowerCase();

    return allEntries
      .filter((entry) => {
        const searchable = `${entry.title} ${entry.content} ${entry.tags.join(" ")}`.toLowerCase();
        return searchable.includes(queryLower);
      })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);
  }

  private async saveKnowledgeEntries(entries: KnowledgeEntry[]): Promise<void> {
    await fs.mkdir(this.knowledgeDir, { recursive: true });
    const filePath = join(this.knowledgeDir, "knowledge.jsonl");

    for (const entry of entries) {
      const line = JSON.stringify(entry) + "\n";
      await fs.appendFile(filePath, line, "utf-8");
    }
  }

  private async loadAllKnowledgeEntries(): Promise<KnowledgeEntry[]> {
    const filePath = join(this.knowledgeDir, "knowledge.jsonl");
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const entries: KnowledgeEntry[] = [];
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as KnowledgeEntry);
        } catch {
          // Skip malformed lines
        }
      }
      return entries;
    } catch {
      return [];
    }
  }
}
