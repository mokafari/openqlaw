/**
 * Synonym Dictionary - Natural Tool Output Variation
 *
 * Inspired by Quake III Bot's synonym-based chat system. Provides
 * weighted random selection of phrases to make agent responses feel
 * more natural and less robotic.
 */

export type SynonymContext =
  | "START_TOOL"
  | "TOOL_SUCCESS"
  | "TOOL_ERROR"
  | "PLANNING"
  | "WAITING"
  | "COMPLETED";

export type SynonymEntry = [string, number]; // [phrase, weight]

export type SynonymDictionary = Record<SynonymContext, SynonymEntry[]>;

/**
 * Default synonym dictionary
 */
export const DEFAULT_SYNONYMS: SynonymDictionary = {
  START_TOOL: [
    ["On it", 0.4],
    ["Checking that now", 0.3],
    ["Scanning...", 0.3],
  ],
  TOOL_SUCCESS: [
    ["Done.", 0.5],
    ["Task complete.", 0.3],
    ["Got it.", 0.2],
  ],
  TOOL_ERROR: [
    ["Hmm, that didn't work.", 0.4],
    ["Let me try a different approach.", 0.3],
    ["That failed, trying again.", 0.3],
  ],
  PLANNING: [
    ["Planning the approach...", 0.4],
    ["Figuring out the best way...", 0.3],
    ["Working on a plan...", 0.3],
  ],
  WAITING: [
    ["Waiting for that to finish...", 0.4],
    ["Let me check back in a moment.", 0.3],
    ["Standing by...", 0.3],
  ],
  COMPLETED: [
    ["All done!", 0.4],
    ["Finished.", 0.3],
    ["Complete.", 0.3],
  ],
};

/**
 * Select a synonym using weighted random selection
 */
export function selectSynonym(
  context: SynonymContext,
  dictionary: SynonymDictionary = DEFAULT_SYNONYMS,
): string {
  const entries = dictionary[context];
  if (!entries || entries.length === 0) {
    return ""; // No synonyms available
  }

  // Calculate total weight
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight === 0) {
    return entries[0]?.[0] ?? "";
  }

  // Random selection based on weights
  let random = Math.random() * totalWeight;
  for (const [phrase, weight] of entries) {
    random -= weight;
    if (random <= 0) {
      return phrase;
    }
  }

  // Fallback to last entry
  return entries[entries.length - 1]?.[0] ?? "";
}

/**
 * Customize synonym dictionary
 */
export function customizeSynonyms(
  base: SynonymDictionary,
  overrides: Partial<SynonymDictionary>,
): SynonymDictionary {
  const customized: SynonymDictionary = { ...base };
  for (const [context, entries] of Object.entries(overrides)) {
    if (entries && Array.isArray(entries)) {
      customized[context as SynonymContext] = entries as SynonymEntry[];
    }
  }
  return customized;
}

/**
 * Load synonyms from SOUL.md format
 *
 * Expected format in SOUL.md:
 * ```yaml
 * synonyms:
 *   START_TOOL:
 *     - ["On it", 0.4]
 *     - ["Checking that now", 0.3]
 * ```
 */
export function parseSynonymsFromSoul(soulContent: string): Partial<SynonymDictionary> {
  const synonyms: Partial<SynonymDictionary> = {};

  // Simple YAML-like parsing (basic implementation)
  // Look for synonyms: section
  const synonymsMatch = soulContent.match(/synonyms:\s*\n((?:[^\n]+\n?)+)/i);
  if (!synonymsMatch) {
    return synonyms;
  }

  const synonymsBlock = synonymsMatch[1];
  const contextMatches = synonymsBlock.matchAll(/(\w+):\s*\n((?:\s+-\s*\[[^\]]+\]\s*\n?)+)/g);

  for (const match of contextMatches) {
    const context = match[1] as SynonymContext;
    const entriesBlock = match[2];

    const entryMatches = entriesBlock.matchAll(/-\s*\["([^"]+)",\s*([\d.]+)\]/g);
    const entries: SynonymEntry[] = [];
    for (const entryMatch of entryMatches) {
      const phrase = entryMatch[1];
      const weight = parseFloat(entryMatch[2] ?? "0");
      if (phrase && !isNaN(weight)) {
        entries.push([phrase, weight]);
      }
    }

    if (entries.length > 0) {
      synonyms[context] = entries;
    }
  }

  return synonyms;
}
