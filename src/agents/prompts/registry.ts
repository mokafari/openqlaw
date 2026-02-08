import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { resolveStateDir } from "../../config/paths.js";

export interface PromptVersion {
  id: string; // SHA256 hash of content
  name: string; // "system-main", "diagnostic-v2"
  content: string; // The actual prompt
  metadata: {
    created: string; // ISO timestamp
    author?: string; // Who created/updated it
    parent?: string; // Previous version id
    rationale?: string; // Why was this changed?
    targetBehaviors: string[]; // What should this improve?
  };
  status: "active" | "testing" | "deprecated" | "archived";
  variant?: {
    baselineId?: string; // Compare against this version
    experimentId?: string; // Which A/B test?
  };
}

export interface PromptExperiment {
  id: string; // exp-control-v47-vs-candidate-v48
  name: string; // "Reduce verbosity test"
  status: "active" | "complete" | "rolled-back";

  baseline: {
    promptId: string;
    allocation: number; // 0.0 - 1.0 (e.g., 0.5 for 50%)
  };

  candidate: {
    promptId: string;
    allocation: number; // 0.0 - 1.0 (e.g., 0.5 for 50%)
  };

  successCriteria: {
    minSampleSize: number; // Need X sessions
    minSignificance: number; // p < 0.05
    winCondition: "baseline" | "candidate" | "none";
    metrics: string[]; // ["tokenEfficiency", "errorRate"]
  };

  results?: {
    winnerPromptId: string;
    improvement: number; // % improvement
    pValue: number; // Statistical significance
    deployedAt?: string;
  };
}

export interface PromptRegistry {
  [promptName: string]: {
    current: string; // Current active version ID
    versions: string[]; // All version IDs in order
    history: PromptVersion[]; // Full version history
  };
}

export interface ExperimentRegistry {
  [experimentId: string]: PromptExperiment;
}

/**
 * Generate SHA256 hash for prompt content (used as version ID).
 */
export function generatePromptId(content: string): string {
  return crypto.createHash("sha256").update(content.trim(), "utf-8").digest("hex").substring(0, 12);
}

/**
 * Get the prompt registry file path.
 */
export function getPromptRegistryPath(): string {
  return path.join(resolveStateDir(), "evolution", "prompts", "registry.json");
}

/**
 * Get the experiment registry file path.
 */
export function getExperimentRegistryPath(): string {
  return path.join(resolveStateDir(), "evolution", "prompts", "experiments.json");
}

/**
 * Load the prompt registry from disk.
 */
export async function loadPromptRegistry(): Promise<PromptRegistry> {
  const registryPath = getPromptRegistryPath();

  try {
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    const content = await fs.readFile(registryPath, "utf-8");
    return JSON.parse(content) as PromptRegistry;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      return {}; // Return empty registry if file doesn't exist
    }
    throw err;
  }
}

/**
 * Save the prompt registry to disk.
 */
export async function savePromptRegistry(registry: PromptRegistry): Promise<void> {
  const registryPath = getPromptRegistryPath();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}

/**
 * Load the experiment registry from disk.
 */
export async function loadExperimentRegistry(): Promise<ExperimentRegistry> {
  const registryPath = getExperimentRegistryPath();

  try {
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    const content = await fs.readFile(registryPath, "utf-8");
    return JSON.parse(content) as ExperimentRegistry;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      return {}; // Return empty registry if file doesn't exist
    }
    throw err;
  }
}

/**
 * Save the experiment registry to disk.
 */
export async function saveExperimentRegistry(registry: ExperimentRegistry): Promise<void> {
  const registryPath = getExperimentRegistryPath();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}

/**
 * Register a new prompt version.
 */
export async function registerPromptVersion(params: {
  name: string;
  content: string;
  metadata: Omit<PromptVersion["metadata"], "created">;
  status?: PromptVersion["status"];
  variant?: PromptVersion["variant"];
}): Promise<PromptVersion> {
  const registry = await loadPromptRegistry();
  const promptId = generatePromptId(params.content);

  const version: PromptVersion = {
    id: promptId,
    name: params.name,
    content: params.content.trim(),
    metadata: {
      ...params.metadata,
      created: new Date().toISOString(),
    },
    status: params.status ?? "active",
    variant: params.variant,
  };

  // Initialize prompt entry if it doesn't exist
  if (!registry[params.name]) {
    registry[params.name] = {
      current: promptId,
      versions: [promptId],
      history: [version],
    };
  } else {
    // Add to existing prompt
    const existing = registry[params.name];

    // Check if this exact content already exists
    const existingVersion = existing.history.find((v) => v.id === promptId);
    if (existingVersion) {
      throw new Error(`Prompt version with ID ${promptId} already exists for ${params.name}`);
    }

    // Add new version
    existing.versions.push(promptId);
    existing.history.push(version);

    // Update current if this is active
    if (version.status === "active") {
      existing.current = promptId;
    }
  }

  await savePromptRegistry(registry);
  return version;
}

/**
 * Get the current active prompt for a given name.
 */
export async function getCurrentPrompt(name: string): Promise<PromptVersion | null> {
  const registry = await loadPromptRegistry();
  const promptEntry = registry[name];

  if (!promptEntry) {
    return null;
  }

  const currentVersion = promptEntry.history.find((v) => v.id === promptEntry.current);
  return currentVersion ?? null;
}

/**
 * Get a specific prompt version by ID.
 */
export async function getPromptVersion(
  name: string,
  versionId: string,
): Promise<PromptVersion | null> {
  const registry = await loadPromptRegistry();
  const promptEntry = registry[name];

  if (!promptEntry) {
    return null;
  }

  return promptEntry.history.find((v) => v.id === versionId) ?? null;
}

/**
 * Set the current active prompt version.
 */
export async function setCurrentPrompt(name: string, versionId: string): Promise<void> {
  const registry = await loadPromptRegistry();
  const promptEntry = registry[name];

  if (!promptEntry) {
    throw new Error(`Prompt ${name} not found in registry`);
  }

  const version = promptEntry.history.find((v) => v.id === versionId);
  if (!version) {
    throw new Error(`Version ${versionId} not found for prompt ${name}`);
  }

  promptEntry.current = versionId;
  await savePromptRegistry(registry);
}

/**
 * List all prompts in the registry.
 */
export async function listPrompts(): Promise<
  Array<{ name: string; current: string; versions: number }>
> {
  const registry = await loadPromptRegistry();

  return Object.entries(registry).map(([name, entry]) => ({
    name,
    current: entry.current,
    versions: entry.versions.length,
  }));
}

/**
 * Get prompt for A/B testing - returns which variant to use.
 */
export async function getPromptForTesting(
  name: string,
  sessionKey: string,
): Promise<{ promptVersion: PromptVersion; experimentId?: string }> {
  const experiments = await loadExperimentRegistry();
  const activeExperiments = Object.values(experiments).filter((exp) => exp.status === "active");

  // Find if there's an active experiment for this prompt
  const experiment = activeExperiments.find((exp) => {
    const baselinePrompt = exp.baseline.promptId.split("-")[0]; // Extract prompt name from ID
    const candidatePrompt = exp.candidate.promptId.split("-")[0];
    // This is a simplified match - you might want more sophisticated logic
    return baselinePrompt === name || candidatePrompt === name;
  });

  if (experiment) {
    // Use deterministic allocation based on session key
    const hash = crypto.createHash("md5").update(sessionKey).digest("hex");
    const allocation = parseInt(hash.substring(0, 8), 16) / 0xffffffff;

    const useCandidate = allocation < experiment.candidate.allocation;
    const promptId = useCandidate ? experiment.candidate.promptId : experiment.baseline.promptId;

    const promptVersion = await getPromptVersion(name, promptId);
    if (!promptVersion) {
      throw new Error(`Prompt version ${promptId} not found for experiment ${experiment.id}`);
    }

    return { promptVersion, experimentId: experiment.id };
  }

  // No active experiment, return current version
  const currentPrompt = await getCurrentPrompt(name);
  if (!currentPrompt) {
    throw new Error(`No current prompt found for ${name}`);
  }

  return { promptVersion: currentPrompt };
}

/**
 * Create a new A/B test experiment.
 */
export async function createExperiment(params: {
  name: string;
  baselinePromptId: string;
  candidatePromptId: string;
  allocation?: { baseline: number; candidate: number };
  successCriteria: Pick<PromptExperiment["successCriteria"], "minSampleSize" | "metrics">;
}): Promise<PromptExperiment> {
  const experiments = await loadExperimentRegistry();
  const experimentId = `exp-${params.baselinePromptId}-vs-${params.candidatePromptId}`;

  const allocation = params.allocation ?? { baseline: 0.5, candidate: 0.5 };

  const experiment: PromptExperiment = {
    id: experimentId,
    name: params.name,
    status: "active",
    baseline: {
      promptId: params.baselinePromptId,
      allocation: allocation.baseline,
    },
    candidate: {
      promptId: params.candidatePromptId,
      allocation: allocation.candidate,
    },
    successCriteria: {
      ...params.successCriteria,
      minSignificance: 0.05, // p < 0.05
      winCondition: "none",
    },
  };

  experiments[experimentId] = experiment;
  await saveExperimentRegistry(experiments);

  return experiment;
}

/**
 * Complete an A/B test experiment.
 */
export async function completeExperiment(
  experimentId: string,
  results: PromptExperiment["results"],
): Promise<void> {
  const experiments = await loadExperimentRegistry();
  const experiment = experiments[experimentId];

  if (!experiment) {
    throw new Error(`Experiment ${experimentId} not found`);
  }

  experiment.status = "complete";
  experiment.results = results;

  await saveExperimentRegistry(experiments);
}

/**
 * Get all active experiments.
 */
export async function getActiveExperiments(): Promise<PromptExperiment[]> {
  const experiments = await loadExperimentRegistry();
  return Object.values(experiments).filter((exp) => exp.status === "active");
}
