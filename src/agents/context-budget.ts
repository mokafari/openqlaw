/**
 * Context Budget Manager
 *
 * Uses Quake FSM state to selectively include/exclude system prompt sections
 * and tool descriptions, reducing token waste. Different FSM states need
 * different context — a camping agent doesn't need evolution docs, an idle
 * agent doesn't need verbose Quake behavior instructions.
 */

import type { ClusterId } from "./aas/types.js";
import type { PromptMode } from "./system-prompt.js";

export type ContextBudgetSection =
  | "cli_reference"
  | "skills"
  | "memory"
  | "self_update"
  | "model_aliases"
  | "documentation"
  | "reply_tags"
  | "messaging"
  | "voice"
  | "reactions"
  | "silent_replies"
  | "heartbeats"
  | "quake_fsm"
  | "quake_goals"
  | "quake_clusters"
  | "quake_capabilities"
  | "quake_evolution";

export type ContextBudget = {
  /** Sections to include in the system prompt. Sections NOT in this set are excluded. */
  includeSections: Set<ContextBudgetSection>;
  /** Which tool clusters to activate for this state. */
  activeClusters: ClusterId[];
  /** When true, Quake sections use one-line summaries instead of verbose instructions. */
  condensedQuake: boolean;
};

const ALL_SECTIONS: ContextBudgetSection[] = [
  "cli_reference",
  "skills",
  "memory",
  "self_update",
  "model_aliases",
  "documentation",
  "reply_tags",
  "messaging",
  "voice",
  "reactions",
  "silent_replies",
  "heartbeats",
  "quake_fsm",
  "quake_goals",
  "quake_clusters",
  "quake_capabilities",
  "quake_evolution",
];

const ALL_CLUSTERS: ClusterId[] = [
  "coding",
  "messaging",
  "web",
  "scheduling",
  "system",
  "filesystem",
  "browser",
];

type StateBudgetRule = {
  exclude: ContextBudgetSection[];
  clusters: ClusterId[];
  condensedQuake: boolean;
};

const STATE_BUDGETS: Record<string, StateBudgetRule> = {
  idle: {
    exclude: ["quake_capabilities", "quake_evolution", "quake_clusters"],
    clusters: ALL_CLUSTERS,
    condensedQuake: true,
  },
  gathering_info: {
    exclude: ["quake_capabilities", "quake_evolution", "messaging", "voice", "reactions"],
    clusters: ["coding", "filesystem", "web", "system"],
    condensedQuake: true,
  },
  planning: {
    exclude: ["quake_capabilities", "quake_evolution", "messaging", "voice", "reactions"],
    clusters: ["coding", "filesystem", "system"],
    condensedQuake: true,
  },
  executing: {
    exclude: [
      "skills",
      "documentation",
      "model_aliases",
      "quake_evolution",
      "quake_capabilities",
      "voice",
      "reactions",
    ],
    clusters: ["coding", "filesystem", "web", "browser", "system"],
    condensedQuake: true,
  },
  verifying: {
    exclude: [
      "skills",
      "documentation",
      "messaging",
      "voice",
      "reactions",
      "quake_evolution",
      "quake_capabilities",
    ],
    clusters: ["coding", "filesystem", "system"],
    condensedQuake: true,
  },
  camping: {
    exclude: [
      "skills",
      "memory",
      "documentation",
      "model_aliases",
      "messaging",
      "voice",
      "reactions",
      "reply_tags",
      "quake_capabilities",
      "quake_evolution",
      "quake_goals",
      "quake_clusters",
      "silent_replies",
      "cli_reference",
      "self_update",
    ],
    clusters: ["scheduling", "system"],
    condensedQuake: true,
  },
  retreating: {
    exclude: ["skills", "documentation", "messaging", "voice", "reactions", "quake_evolution"],
    clusters: ["coding", "filesystem", "system"],
    condensedQuake: true,
  },
  reporting: {
    exclude: ["skills", "documentation", "quake_evolution", "quake_capabilities", "voice"],
    clusters: ["messaging", "system"],
    condensedQuake: true,
  },
  diagnostic: {
    exclude: ["messaging", "voice", "reactions", "skills"],
    clusters: ["coding", "filesystem", "system"],
    condensedQuake: false,
  },
  mutating: {
    exclude: ["messaging", "voice", "reactions", "skills"],
    clusters: ["coding", "filesystem", "system"],
    condensedQuake: false,
  },
  self_correcting: {
    exclude: ["messaging", "voice", "reactions", "skills"],
    clusters: ["coding", "filesystem", "system"],
    condensedQuake: false,
  },
};

export function resolveContextBudget(params: {
  fsmState?: string;
  goalStackDepth: number;
  hasEvolutionTools: boolean;
  promptMode: PromptMode;
  toolNames: string[];
}): ContextBudget {
  // For "minimal" or "none" prompt modes, defer to existing behavior (full sections)
  if (params.promptMode === "minimal" || params.promptMode === "none") {
    return {
      includeSections: new Set(ALL_SECTIONS),
      activeClusters: ALL_CLUSTERS,
      condensedQuake: false,
    };
  }

  // No FSM state → backward compat, include everything
  if (!params.fsmState) {
    return {
      includeSections: new Set(ALL_SECTIONS),
      activeClusters: ALL_CLUSTERS,
      condensedQuake: false,
    };
  }

  const rule = STATE_BUDGETS[params.fsmState];
  if (!rule) {
    // Unknown state → full budget (safe fallback)
    return {
      includeSections: new Set(ALL_SECTIONS),
      activeClusters: ALL_CLUSTERS,
      condensedQuake: false,
    };
  }

  const included = new Set(ALL_SECTIONS);
  for (const section of rule.exclude) {
    included.delete(section);
  }

  // Special rule: evolution states with evolution tools → include quake_evolution
  if (
    params.hasEvolutionTools &&
    (params.fsmState === "diagnostic" ||
      params.fsmState === "mutating" ||
      params.fsmState === "self_correcting")
  ) {
    included.add("quake_evolution");
  }

  // Special rule: goal stack depth > 0 → always include quake_goals
  if (params.goalStackDepth > 0) {
    included.add("quake_goals");
  }

  return {
    includeSections: included,
    activeClusters: rule.clusters,
    condensedQuake: rule.condensedQuake,
  };
}

/**
 * Check if a section should be included given a budget.
 * If no budget is provided, the section is always included (backward compat).
 */
export function sectionOn(
  budget: ContextBudget | undefined,
  section: ContextBudgetSection,
): boolean {
  return !budget || budget.includeSections.has(section);
}
