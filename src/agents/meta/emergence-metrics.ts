/**
 * Emergence Metrics - Track curiosity, novelty, and breakthroughs
 * Part of AGI 2026 TIER 3: Emergence Measurement
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const DATA_DIR =
  process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME || "", ".openclaw", "workspace");
const METRICS_FILE = path.join(DATA_DIR, "data", "emergence-metrics.jsonl");

// Types
export interface NoveltyEvent {
  type: "novelty";
  timestamp: number;
  category: "query" | "pattern" | "tool_use" | "reasoning" | "cross_domain";
  description: string;
  noveltyScore: number; // 0-1, higher = more novel
  context?: string;
}

export interface BreakthroughEvent {
  type: "breakthrough";
  timestamp: number;
  capability: string;
  previousLevel: number;
  newLevel: number;
  evidence: string;
  significance: "minor" | "moderate" | "major";
}

export interface CuriosityEvent {
  type: "curiosity";
  timestamp: number;
  query: string;
  domain: string;
  selfInitiated: boolean;
  followUpCount: number;
}

export type EmergenceEvent = NoveltyEvent | BreakthroughEvent | CuriosityEvent;

// Append event to file
async function appendEvent(event: EmergenceEvent): Promise<void> {
  await fs.mkdir(path.dirname(METRICS_FILE), { recursive: true });
  await fs.appendFile(METRICS_FILE, JSON.stringify(event) + "\n");
}

// Load events from file
async function loadEvents(): Promise<EmergenceEvent[]> {
  try {
    const content = await fs.readFile(METRICS_FILE, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((x): x is EmergenceEvent => x !== null);
  } catch {
    return [];
  }
}

// Log a novelty event
export async function logNovelty(
  category: NoveltyEvent["category"],
  description: string,
  noveltyScore: number,
  context?: string,
): Promise<void> {
  const event: NoveltyEvent = {
    type: "novelty",
    timestamp: Date.now(),
    category,
    description,
    noveltyScore: Math.max(0, Math.min(1, noveltyScore)),
    context,
  };
  await appendEvent(event);
}

// Log a breakthrough
export async function logBreakthrough(
  capability: string,
  previousLevel: number,
  newLevel: number,
  evidence: string,
  significance: BreakthroughEvent["significance"] = "minor",
): Promise<void> {
  const event: BreakthroughEvent = {
    type: "breakthrough",
    timestamp: Date.now(),
    capability,
    previousLevel,
    newLevel,
    evidence,
    significance,
  };
  await appendEvent(event);
}

// Log curiosity-driven exploration
export async function logCuriosity(
  query: string,
  domain: string,
  selfInitiated: boolean = false,
  followUpCount: number = 0,
): Promise<void> {
  const event: CuriosityEvent = {
    type: "curiosity",
    timestamp: Date.now(),
    query,
    domain,
    selfInitiated,
    followUpCount,
  };
  await appendEvent(event);
}

// Detect breakthrough by comparing capability levels
export async function detectBreakthrough(
  capability: string,
  currentLevel: number,
  threshold: number = 0.1,
): Promise<{ isBreakthrough: boolean; previousLevel: number }> {
  const events = await loadEvents();

  // Find most recent level for this capability
  const capabilityEvents = events
    .filter((e): e is BreakthroughEvent => e.type === "breakthrough" && e.capability === capability)
    .sort((a, b) => b.timestamp - a.timestamp);

  const previousLevel = capabilityEvents[0]?.newLevel ?? 0;
  const improvement = currentLevel - previousLevel;

  return {
    isBreakthrough: improvement >= threshold,
    previousLevel,
  };
}

// Get curiosity score (based on self-initiated queries)
export async function getCuriosityScore(sinceDays: number = 7): Promise<{
  score: number;
  totalQueries: number;
  selfInitiatedRatio: number;
  topDomains: Array<{ domain: string; count: number }>;
}> {
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const events = await loadEvents();

  const curiosityEvents = events.filter(
    (e): e is CuriosityEvent => e.type === "curiosity" && e.timestamp > cutoff,
  );

  if (curiosityEvents.length === 0) {
    return { score: 0, totalQueries: 0, selfInitiatedRatio: 0, topDomains: [] };
  }

  const selfInitiated = curiosityEvents.filter((e) => e.selfInitiated).length;
  const selfInitiatedRatio = selfInitiated / curiosityEvents.length;

  // Count by domain
  const domainCounts: Record<string, number> = {};
  for (const event of curiosityEvents) {
    domainCounts[event.domain] = (domainCounts[event.domain] || 0) + 1;
  }

  const topDomains = Object.entries(domainCounts)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Score: weighted by self-initiation and follow-ups
  const avgFollowUps =
    curiosityEvents.reduce((sum, e) => sum + e.followUpCount, 0) / curiosityEvents.length;
  const score = selfInitiatedRatio * 0.6 + Math.min(avgFollowUps / 3, 1) * 0.4;

  return {
    score,
    totalQueries: curiosityEvents.length,
    selfInitiatedRatio,
    topDomains,
  };
}

// Get novelty summary
export async function getNoveltyReport(sinceDays: number = 7): Promise<{
  totalNovelties: number;
  avgNoveltyScore: number;
  byCategory: Record<string, { count: number; avgScore: number }>;
  topNovelties: NoveltyEvent[];
}> {
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const events = await loadEvents();

  const noveltyEvents = events.filter(
    (e): e is NoveltyEvent => e.type === "novelty" && e.timestamp > cutoff,
  );

  if (noveltyEvents.length === 0) {
    return { totalNovelties: 0, avgNoveltyScore: 0, byCategory: {}, topNovelties: [] };
  }

  const avgNoveltyScore =
    noveltyEvents.reduce((sum, e) => sum + e.noveltyScore, 0) / noveltyEvents.length;

  // Group by category
  const byCategory: Record<string, { count: number; totalScore: number }> = {};
  for (const event of noveltyEvents) {
    if (!byCategory[event.category]) {
      byCategory[event.category] = { count: 0, totalScore: 0 };
    }
    byCategory[event.category].count++;
    byCategory[event.category].totalScore += event.noveltyScore;
  }

  const byCategoryResult: Record<string, { count: number; avgScore: number }> = {};
  for (const [cat, data] of Object.entries(byCategory)) {
    byCategoryResult[cat] = {
      count: data.count,
      avgScore: data.totalScore / data.count,
    };
  }

  // Top novelties
  const topNovelties = noveltyEvents.sort((a, b) => b.noveltyScore - a.noveltyScore).slice(0, 5);

  return {
    totalNovelties: noveltyEvents.length,
    avgNoveltyScore,
    byCategory: byCategoryResult,
    topNovelties,
  };
}

// Get breakthroughs
export async function getBreakthroughs(sinceDays: number = 30): Promise<BreakthroughEvent[]> {
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const events = await loadEvents();

  return events
    .filter((e): e is BreakthroughEvent => e.type === "breakthrough" && e.timestamp > cutoff)
    .sort((a, b) => b.timestamp - a.timestamp);
}
