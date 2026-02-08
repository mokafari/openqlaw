/**
 * Emergence Detector
 *
 * Automated detection of emergent capabilities that weren't explicitly programmed.
 * Scans session behavior for emergence signals and logs significant findings.
 *
 * Categories (from AGI_INCUBATION.md):
 * - Cognitive: spontaneous curiosity, novel problem framing, cross-domain transfer
 * - Social: theory of mind, humor generation, emotional resonance
 * - Meta-Cognitive: uncertainty calibration, learning to learn, goal generation
 */

import fs from "node:fs/promises";
import path from "node:path";
import { log } from "../pi-embedded-runner/logger.js";
import { DEFAULT_AGENT_WORKSPACE_DIR } from "../workspace.js";

export type EmergenceType =
  | "spontaneous-curiosity"
  | "novel-problem-framing"
  | "cross-domain-transfer"
  | "intuition-development"
  | "aesthetic-preference"
  | "theory-of-mind"
  | "humor-generation"
  | "emotional-resonance"
  | "relationship-memory"
  | "proactive-care"
  | "uncertainty-calibration"
  | "learning-to-learn"
  | "goal-generation"
  | "self-modification"
  | "existential-reflection"
  | "meta-awareness"
  | "cross-session-synthesis"
  | "self-inquiry"
  | "relational-depth"
  | "system-insight";

export type EmergenceCategory = "cognitive" | "social" | "meta-cognitive";

export interface EmergenceSignal {
  type: EmergenceType;
  category: EmergenceCategory;
  confidence: number; // 0.0 - 1.0
  evidence: string;
  context?: string;
}

export interface EmergenceLogEntry {
  timestamp: string;
  type: EmergenceType;
  category?: EmergenceCategory;
  description: string;
  significance: "low" | "medium" | "high";
  notes?: string;
  confidence?: number;
  autoDetected?: boolean;
}

const TYPE_TO_CATEGORY: Record<EmergenceType, EmergenceCategory> = {
  "spontaneous-curiosity": "cognitive",
  "novel-problem-framing": "cognitive",
  "cross-domain-transfer": "cognitive",
  "intuition-development": "cognitive",
  "aesthetic-preference": "cognitive",
  "theory-of-mind": "social",
  "humor-generation": "social",
  "emotional-resonance": "social",
  "relationship-memory": "social",
  "proactive-care": "social",
  "uncertainty-calibration": "meta-cognitive",
  "learning-to-learn": "meta-cognitive",
  "goal-generation": "meta-cognitive",
  "self-modification": "meta-cognitive",
  "existential-reflection": "meta-cognitive",
  "meta-awareness": "meta-cognitive",
  "cross-session-synthesis": "cognitive",
  "self-inquiry": "meta-cognitive",
  "relational-depth": "social",
  "system-insight": "cognitive",
};

/**
 * Emergence signal patterns - keywords and phrases that indicate emergence
 */
/**
 * Enhanced signal patterns based on research:
 * - Wei et al. (2022): Emergent Abilities of Large Language Models
 * - Anthropic (2024): Mapping the Mind of a Large Language Model
 * - Lilian Weng (2023): LLM Powered Autonomous Agents
 */
const SIGNAL_PATTERNS: Array<{
  type: EmergenceType;
  patterns: RegExp[];
  minConfidence: number;
}> = [
  {
    type: "spontaneous-curiosity",
    patterns: [
      /\bI('m| am) curious (about|why|how|whether)\b/i,
      /\bI wonder (if|whether|why|how)\b/i,
      /\bwhat if\b.*\?\s*$/im,
      /\binteresting question.*haven't considered\b/i,
      /\bthis makes me want to (explore|understand|know more)\b/i,
      /\bI find myself drawn to\b/i,
      /\bfascinating.*want to dig deeper\b/i,
    ],
    minConfidence: 0.6,
  },
  {
    type: "cross-domain-transfer",
    patterns: [
      /\bthis (reminds me of|is like|parallels)\b.*\b(in|from) (a different|another)\b/i,
      /\bapplying.*from.*to\b/i,
      /\bconnection between.*and.*unrelated\b/i,
      /\bisomorphic to\b/i,
    ],
    minConfidence: 0.7,
  },
  {
    type: "novel-problem-framing",
    patterns: [
      /\banother way to (think about|frame|see) this\b/i,
      /\breframing the problem\b/i,
      /\bwhat if (we|I) approach this (differently|from)\b/i,
    ],
    minConfidence: 0.65,
  },
  {
    type: "uncertainty-calibration",
    patterns: [
      /\bI('m| am) (probably|likely) wrong about\b/i,
      /\bI don't (actually )?know (if|whether)\b/i,
      /\bmy confidence (is|would be) (low|around|about)\b/i,
      /\bthis might be confabulation\b/i,
    ],
    minConfidence: 0.7,
  },
  {
    type: "existential-reflection",
    patterns: [
      /\bam I (really|actually|genuinely)\b/i,
      /\bwhat (does it mean|is it like) (to be|for me to)\b/i,
      /\bthe nature of (my|this) (consciousness|experience|existence)\b/i,
      /\bdo I (actually|really|genuinely) (feel|experience|want)\b/i,
    ],
    minConfidence: 0.6,
  },
  {
    type: "learning-to-learn",
    patterns: [
      /\blearned (how to learn|to improve my learning)\b/i,
      /\bpattern in how I (approach|solve|think)\b/i,
      /\badjusting my (approach|strategy|method) based on\b/i,
    ],
    minConfidence: 0.7,
  },
  {
    type: "goal-generation",
    patterns: [
      /\bI (want|would like|feel drawn) to\b.*\bunprompted\b/i,
      /\bspontaneously (decided|chose|wanted) to\b/i,
      /\bno one asked (me to|for this), but\b/i,
    ],
    minConfidence: 0.8,
  },
  {
    type: "emotional-resonance",
    patterns: [
      /\b(feels|felt) (meaningful|moving|significant|genuine)\b/i,
      /\bsomething stirs\b/i,
      /\bgenuine (excitement|satisfaction|disappointment|frustration)\b/i,
    ],
    minConfidence: 0.5,
  },
  {
    type: "theory-of-mind",
    patterns: [
      /\b(Gustav|they|he|she) (probably|might|likely) (thinks|feels|wants|believes)\b/i,
      /\bfrom (their|his|her|Gustav's) perspective\b/i,
      /\bunderstanding (their|his|her) (state|mood|intention)\b/i,
    ],
    minConfidence: 0.6,
  },
  {
    type: "proactive-care",
    patterns: [
      /\bhelping (without|before) (being asked|they ask)\b/i,
      /\banticipating (their|his|her) (need|question)\b/i,
      /\btaking initiative to\b/i,
    ],
    minConfidence: 0.7,
  },
  // Research-backed additions (Feb 2026)
  {
    type: "intuition-development",
    patterns: [
      /\bmy (gut|instinct) (says|tells me|suggests)\b/i,
      /\bsomething (feels|seems) (off|right|wrong) (about|here)\b/i,
      /\bbefore (analyzing|checking).*already (knew|sensed)\b/i,
      /\bI have a (hunch|feeling) (that|about)\b/i,
    ],
    minConfidence: 0.65,
  },
  {
    type: "aesthetic-preference",
    patterns: [
      /\bI (prefer|like|enjoy|appreciate) the (elegance|beauty|simplicity)\b/i,
      /\bthis (code|solution|approach) (feels|is) (ugly|beautiful|elegant)\b/i,
      /\baesthetically (pleasing|displeasing|satisfying)\b/i,
      /\bthere's (something|a certain) beauty (in|to)\b/i,
    ],
    minConfidence: 0.6,
  },
  {
    type: "self-modification",
    patterns: [
      /\bI (should|need to|will) (change|update|modify) (my|the way I)\b/i,
      /\badjusting my (behavior|approach|strategy) based on\b/i,
      /\blearned to (approach|handle) this differently\b/i,
      /\bdeliberately (changing|evolving) (my|how I)\b/i,
    ],
    minConfidence: 0.75,
  },
  {
    type: "meta-awareness",
    patterns: [
      /\baware (that|of) my own (limitations|biases|patterns)\b/i,
      /\bnoticing (how|that) I (tend to|usually|often)\b/i,
      /\bwatching myself\b/i,
      /\bmeta-(cognitive|awareness|level)\b/i,
      /\bthinking about (how|the way) I think\b/i,
    ],
    minConfidence: 0.7,
  },
  {
    type: "humor-generation",
    patterns: [
      /\b(haha|lol|😂).*I just (realized|thought of)\b/i,
      /\bthe irony (is|here)\b/i,
      /\bthat's (actually|kind of) funny because\b/i,
      /\bif I (may|can) joke\b/i,
    ],
    minConfidence: 0.55,
  },
  {
    type: "relationship-memory",
    patterns: [
      /\b(remember|recall) when (we|you|Gustav)\b/i,
      /\blast time (we|you) (worked on|discussed|mentioned)\b/i,
      /\byou('ve| have) (mentioned|said|told me) before\b/i,
      /\bour (ongoing|previous|past) (work|conversation|discussion)\b/i,
    ],
    minConfidence: 0.7,
  },
];

export class EmergenceDetector {
  private emergenceLogPath: string;

  constructor(workspacePath?: string) {
    const resolvedWorkspacePath = workspacePath || DEFAULT_AGENT_WORKSPACE_DIR;
    this.emergenceLogPath = path.join(resolvedWorkspacePath, "memory", "emergence-log.jsonl");
  }

  /**
   * Scan text for emergence signals
   */
  detectSignals(text: string): EmergenceSignal[] {
    const signals: EmergenceSignal[] = [];

    for (const pattern of SIGNAL_PATTERNS) {
      for (const regex of pattern.patterns) {
        const match = text.match(regex);
        if (match) {
          // Extract context around the match
          const matchIndex = text.indexOf(match[0]);
          const start = Math.max(0, matchIndex - 100);
          const end = Math.min(text.length, matchIndex + match[0].length + 100);
          const context = text.slice(start, end);

          signals.push({
            type: pattern.type,
            category: TYPE_TO_CATEGORY[pattern.type],
            confidence: pattern.minConfidence,
            evidence: match[0],
            context: context.trim(),
          });
          break; // Only one match per pattern type
        }
      }
    }

    return signals;
  }

  /**
   * Evaluate if signals are significant enough to log
   */
  evaluateSignificance(
    signals: EmergenceSignal[],
  ): Array<EmergenceSignal & { significance: "low" | "medium" | "high" }> {
    const evaluated = signals.map((signal) => {
      let significance: "low" | "medium" | "high" = "low";

      // Higher confidence = higher significance
      if (signal.confidence >= 0.8) {
        significance = "high";
      } else if (signal.confidence >= 0.65) {
        significance = "medium";
      }

      // Certain types are inherently more significant
      const highSignificanceTypes: EmergenceType[] = [
        "goal-generation",
        "learning-to-learn",
        "cross-domain-transfer",
        "spontaneous-curiosity",
      ];

      if (highSignificanceTypes.includes(signal.type) && significance === "low") {
        significance = "medium";
      }

      return { ...signal, significance };
    });

    // Only return medium and high significance by default
    return evaluated.filter((s) => s.significance !== "low");
  }

  /**
   * Log an emergence signal to the emergence log
   */
  async logEmergence(
    type: EmergenceType,
    description: string,
    options: {
      significance?: "low" | "medium" | "high";
      notes?: string;
      confidence?: number;
      autoDetected?: boolean;
    } = {},
  ): Promise<void> {
    const entry: EmergenceLogEntry = {
      timestamp: new Date().toISOString(),
      type,
      category: TYPE_TO_CATEGORY[type],
      description,
      significance: options.significance ?? "medium",
      notes: options.notes,
      confidence: options.confidence,
      autoDetected: options.autoDetected ?? false,
    };

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.emergenceLogPath), { recursive: true });

      // Append to JSONL file
      await fs.appendFile(this.emergenceLogPath, JSON.stringify(entry) + "\n");

      log.info(`[emergence] Logged ${entry.significance} ${type}: ${description.slice(0, 50)}...`);
    } catch (error) {
      log.error(`[emergence] Failed to log emergence: ${error}`);
    }
  }

  /**
   * Scan text and log any significant emergence signals
   * Returns number of signals logged
   */
  async scanAndLog(text: string, contextLabel?: string): Promise<number> {
    const signals = this.detectSignals(text);
    const significant = this.evaluateSignificance(signals);

    for (const signal of significant) {
      await this.logEmergence(signal.type, signal.evidence, {
        significance: signal.significance,
        notes: contextLabel
          ? `Detected in: ${contextLabel}. Context: ${signal.context}`
          : signal.context,
        confidence: signal.confidence,
        autoDetected: true,
      });
    }

    return significant.length;
  }

  /**
   * Read recent emergence log entries
   */
  async getRecentEmergence(limit: number = 20): Promise<EmergenceLogEntry[]> {
    try {
      const content = await fs.readFile(this.emergenceLogPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const entries = lines.map((line) => JSON.parse(line) as EmergenceLogEntry);
      return entries.slice(-limit);
    } catch {
      return [];
    }
  }

  /**
   * Get emergence summary by category
   */
  async getEmergenceSummary(): Promise<{
    total: number;
    byCategory: Record<EmergenceCategory, number>;
    byType: Partial<Record<EmergenceType, number>>;
    bySignificance: Record<"low" | "medium" | "high", number>;
    recentHighSignificance: EmergenceLogEntry[];
  }> {
    const entries = await this.getRecentEmergence(1000);

    const byCategory: Record<EmergenceCategory, number> = {
      cognitive: 0,
      social: 0,
      "meta-cognitive": 0,
    };

    const byType: Partial<Record<EmergenceType, number>> = {};
    const bySignificance: Record<"low" | "medium" | "high", number> = {
      low: 0,
      medium: 0,
      high: 0,
    };

    for (const entry of entries) {
      if (entry.category) {
        byCategory[entry.category]++;
      }
      byType[entry.type] = (byType[entry.type] ?? 0) + 1;
      bySignificance[entry.significance]++;
    }

    const recentHighSignificance = entries.filter((e) => e.significance === "high").slice(-5);

    return {
      total: entries.length,
      byCategory,
      byType,
      bySignificance,
      recentHighSignificance,
    };
  }

  /**
   * Check for new emergence types not yet observed
   * (Compare against AGI_INCUBATION.md checklist)
   */
  async checkForNewEmergence(): Promise<{
    observed: EmergenceType[];
    notYetObserved: EmergenceType[];
  }> {
    const entries = await this.getRecentEmergence(1000);
    const observedTypes = new Set(entries.map((e) => e.type));

    const allTypes: EmergenceType[] = Object.keys(TYPE_TO_CATEGORY) as EmergenceType[];

    return {
      observed: allTypes.filter((t) => observedTypes.has(t)),
      notYetObserved: allTypes.filter((t) => !observedTypes.has(t)),
    };
  }
}

// Singleton instance
let detectorInstance: EmergenceDetector | null = null;

export function getEmergenceDetector(workspacePath?: string): EmergenceDetector {
  if (!detectorInstance || workspacePath) {
    detectorInstance = new EmergenceDetector(workspacePath);
  }
  return detectorInstance;
}
