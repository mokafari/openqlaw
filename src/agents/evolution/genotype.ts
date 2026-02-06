import fsSync from "fs";
import { promises as fs } from "fs";
import path from "path";
import { resolveStateDir } from "../../config/paths.js";

/**
 * Genotype represents the "DNA" of an agent - its configurable traits
 * that can be evolved over generations.
 */
export type AgentGenotype = {
  generation: number;
  genotypeId: string;
  traits: {
    /** Verbosity level (0.0 = minimal, 1.0 = verbose) */
    verbosity: number;
    /** Planning depth preference ("shallow" | "medium" | "deep") */
    planningDepth: "shallow" | "medium" | "deep";
    /** Tool eagerness (0.0 = conservative, 1.0 = eager) */
    toolEagerness: number;
    /** Chain-of-thought preference (0.0 = none, 1.0 = always) */
    chainOfThought: number;
    /** Temperature for model (0.0 = deterministic, 1.0 = creative) */
    temperature?: number;
    /** Context window preference (lower = more focused) */
    contextWindowPreference?: "small" | "medium" | "large";
  };
  systemPrompt: {
    /** Tone instructions */
    tone: "concise" | "explanatory" | "balanced";
    /** Whether to emphasize tool usage */
    emphasizeTools: boolean;
    /** Whether to emphasize planning */
    emphasizePlanning: boolean;
  };
  fuzzyWeights: {
    /** Task complexity threshold for model switching (0.0 - 1.0) */
    taskComplexityThreshold: number;
    /** Tool preference weights (normalized) */
    toolPreferences: Record<string, number>;
  };
  /** Parent genotypes (for tracking lineage) */
  parents?: string[];
  /** Creation timestamp */
  createdAt: number;
  /** Last fitness score */
  lastFitness?: number;
};

const DEFAULT_GENOTYPE: Omit<AgentGenotype, "generation" | "genotypeId" | "createdAt"> = {
  traits: {
    verbosity: 0.5,
    planningDepth: "medium",
    toolEagerness: 0.7,
    chainOfThought: 0.5,
    temperature: undefined,
    contextWindowPreference: "medium",
  },
  systemPrompt: {
    tone: "balanced",
    emphasizeTools: true,
    emphasizePlanning: false,
  },
  fuzzyWeights: {
    taskComplexityThreshold: 0.5,
    toolPreferences: {},
  },
};

/**
 * Load genotype from file or create default (synchronous).
 */
export function loadGenotypeSync(params?: {
  genotypeDir?: string;
  genotypeId?: string;
}): AgentGenotype {
  const genotypeDir = params?.genotypeDir ?? path.join(resolveStateDir(), "evolution", "genotypes");
  if (!fsSync.existsSync(genotypeDir)) {
    fsSync.mkdirSync(genotypeDir, { recursive: true });
  }

  const genotypeId = params?.genotypeId ?? "current";
  const genotypeFile = path.join(genotypeDir, `${genotypeId}.json`);

  try {
    if (fsSync.existsSync(genotypeFile)) {
      const content = fsSync.readFileSync(genotypeFile, "utf-8");
      try {
        return JSON.parse(content) as AgentGenotype;
      } catch (parseErr) {
        // File exists but is malformed - create default
        const defaultGenotype: AgentGenotype = {
          ...DEFAULT_GENOTYPE,
          generation: 1,
          genotypeId,
          createdAt: Date.now(),
        };
        saveGenotypeSync(defaultGenotype, { genotypeDir });
        return defaultGenotype;
      }
    } else {
      // Create default genotype
      const defaultGenotype: AgentGenotype = {
        ...DEFAULT_GENOTYPE,
        generation: 1,
        genotypeId,
        createdAt: Date.now(),
      };
      saveGenotypeSync(defaultGenotype, { genotypeDir });
      return defaultGenotype;
    }
  } catch (err) {
    // If anything fails, return default but don't save
    return {
      ...DEFAULT_GENOTYPE,
      generation: 1,
      genotypeId,
      createdAt: Date.now(),
    };
  }
}

/**
 * Save genotype to file (synchronous).
 */
export function saveGenotypeSync(genotype: AgentGenotype, params?: { genotypeDir?: string }): void {
  const genotypeDir = params?.genotypeDir ?? path.join(resolveStateDir(), "evolution", "genotypes");
  if (!fsSync.existsSync(genotypeDir)) {
    fsSync.mkdirSync(genotypeDir, { recursive: true });
  }

  const genotypeFile = path.join(genotypeDir, `${genotype.genotypeId}.json`);
  fsSync.writeFileSync(genotypeFile, JSON.stringify(genotype, null, 2), "utf-8");
}

/**
 * Load genotype from file or create default.
 */
export async function loadGenotype(params?: {
  genotypeDir?: string;
  genotypeId?: string;
}): Promise<AgentGenotype> {
  const genotypeDir = params?.genotypeDir ?? path.join(resolveStateDir(), "evolution", "genotypes");
  await fs.mkdir(genotypeDir, { recursive: true });

  const genotypeId = params?.genotypeId ?? "current";
  const genotypeFile = path.join(genotypeDir, `${genotypeId}.json`);

  try {
    const content = await fs.readFile(genotypeFile, "utf-8");
    try {
      return JSON.parse(content) as AgentGenotype;
    } catch (parseErr) {
      // File exists but is malformed - create default
      const defaultGenotype: AgentGenotype = {
        ...DEFAULT_GENOTYPE,
        generation: 1,
        genotypeId,
        createdAt: Date.now(),
      };
      await saveGenotype(defaultGenotype, { genotypeDir });
      return defaultGenotype;
    }
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      // Create default genotype
      const defaultGenotype: AgentGenotype = {
        ...DEFAULT_GENOTYPE,
        generation: 1,
        genotypeId,
        createdAt: Date.now(),
      };
      await saveGenotype(defaultGenotype, { genotypeDir });
      return defaultGenotype;
    }
    throw err;
  }
}

/**
 * Save genotype to file.
 */
export async function saveGenotype(
  genotype: AgentGenotype,
  params?: { genotypeDir?: string },
): Promise<void> {
  const genotypeDir = params?.genotypeDir ?? path.join(resolveStateDir(), "evolution", "genotypes");
  await fs.mkdir(genotypeDir, { recursive: true });

  const genotypeFile = path.join(genotypeDir, `${genotype.genotypeId}.json`);
  await fs.writeFile(genotypeFile, JSON.stringify(genotype, null, 2), "utf-8");
}

/**
 * Create a mutated variant of a genotype.
 */
export function mutateGenotype(parent: AgentGenotype, mutationRate: number = 0.1): AgentGenotype {
  const newId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // Mutate traits with small random changes
  const mutate = (value: number, min: number = 0, max: number = 1): number => {
    const delta = (Math.random() - 0.5) * 2 * mutationRate;
    return Math.max(min, Math.min(max, value + delta));
  };

  return {
    ...parent,
    genotypeId: newId,
    generation: parent.generation + 1,
    parents: [parent.genotypeId],
    createdAt: Date.now(),
    traits: {
      verbosity: mutate(parent.traits.verbosity),
      planningDepth: parent.traits.planningDepth, // Keep enum values (could mutate to adjacent values if needed)
      toolEagerness: mutate(parent.traits.toolEagerness),
      chainOfThought: mutate(parent.traits.chainOfThought),
      temperature: parent.traits.temperature ? mutate(parent.traits.temperature, 0, 1) : undefined,
      contextWindowPreference: parent.traits.contextWindowPreference,
    },
    systemPrompt: {
      ...parent.systemPrompt,
      // Occasionally flip boolean traits (only if mutation occurs)
      emphasizeTools:
        Math.random() < mutationRate
          ? !parent.systemPrompt.emphasizeTools
          : parent.systemPrompt.emphasizeTools,
      emphasizePlanning:
        Math.random() < mutationRate
          ? !parent.systemPrompt.emphasizePlanning
          : parent.systemPrompt.emphasizePlanning,
    },
    fuzzyWeights: {
      taskComplexityThreshold: mutate(parent.fuzzyWeights.taskComplexityThreshold),
      toolPreferences: { ...parent.fuzzyWeights.toolPreferences },
    },
  };
}

/**
 * Interbreed two parent genotypes to create a child.
 */
export function interbreedGenotypes(parent1: AgentGenotype, parent2: AgentGenotype): AgentGenotype {
  const newId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const generation = Math.max(parent1.generation, parent2.generation) + 1;

  // Average numeric traits
  const average = (a: number, b: number): number => (a + b) / 2;

  // Choose planning depth from parent with higher fitness (or random if equal)
  const planningDepth =
    (parent1.lastFitness ?? 0) > (parent2.lastFitness ?? 0)
      ? parent1.traits.planningDepth
      : parent2.traits.planningDepth;

  return {
    generation,
    genotypeId: newId,
    traits: {
      verbosity: average(parent1.traits.verbosity, parent2.traits.verbosity),
      planningDepth,
      toolEagerness: average(parent1.traits.toolEagerness, parent2.traits.toolEagerness),
      chainOfThought: average(parent1.traits.chainOfThought, parent2.traits.chainOfThought),
      temperature:
        parent1.traits.temperature && parent2.traits.temperature
          ? average(parent1.traits.temperature, parent2.traits.temperature)
          : (parent1.traits.temperature ?? parent2.traits.temperature),
      contextWindowPreference:
        parent1.traits.contextWindowPreference === parent2.traits.contextWindowPreference
          ? parent1.traits.contextWindowPreference
          : "medium", // Default to medium if different
    },
    systemPrompt: {
      tone:
        parent1.systemPrompt.tone === parent2.systemPrompt.tone
          ? parent1.systemPrompt.tone
          : "balanced",
      emphasizeTools: parent1.systemPrompt.emphasizeTools && parent2.systemPrompt.emphasizeTools,
      emphasizePlanning:
        parent1.systemPrompt.emphasizePlanning || parent2.systemPrompt.emphasizePlanning,
    },
    fuzzyWeights: {
      taskComplexityThreshold: average(
        parent1.fuzzyWeights.taskComplexityThreshold,
        parent2.fuzzyWeights.taskComplexityThreshold,
      ),
      toolPreferences: {
        // Merge tool preferences (average if both have it)
        ...parent1.fuzzyWeights.toolPreferences,
        ...Object.fromEntries(
          Object.entries(parent2.fuzzyWeights.toolPreferences).map(([key, value]) => [
            key,
            parent1.fuzzyWeights.toolPreferences[key]
              ? average(parent1.fuzzyWeights.toolPreferences[key], value)
              : value,
          ]),
        ),
      },
    },
    parents: [parent1.genotypeId, parent2.genotypeId],
    createdAt: Date.now(),
  };
}

/**
 * Apply genotype to system prompt modifications.
 */
export function applyGenotypeToSystemPrompt(genotype: AgentGenotype, basePrompt: string): string {
  const additions: string[] = [];

  // Add tone instructions
  if (genotype.systemPrompt.tone === "concise") {
    additions.push("Be concise and direct in your responses.");
  } else if (genotype.systemPrompt.tone === "explanatory") {
    additions.push("Provide detailed explanations when helpful.");
  }

  // Add planning emphasis
  if (genotype.systemPrompt.emphasizePlanning && genotype.traits.planningDepth === "deep") {
    additions.push("Before starting complex tasks, create a detailed step-by-step plan.");
  }

  // Add tool emphasis
  if (genotype.systemPrompt.emphasizeTools && genotype.traits.toolEagerness > 0.7) {
    additions.push("Prefer using tools proactively to gather information and execute tasks.");
  }

  // Add chain-of-thought guidance
  if (genotype.traits.chainOfThought > 0.7) {
    additions.push("Show your reasoning process when solving problems.");
  } else if (genotype.traits.chainOfThought < 0.3) {
    additions.push("Provide direct answers without excessive reasoning steps.");
  }

  if (additions.length > 0) {
    return basePrompt + "\n\n## Evolution-Guided Behavior\n" + additions.join("\n") + "\n";
  }

  return basePrompt;
}
