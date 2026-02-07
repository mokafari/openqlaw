import type { OpenClawConfig } from "../config/config.js";
import type { FailoverReason } from "./pi-embedded-helpers.js";
import {
  ensureAuthProfileStore,
  isProfileInCooldown,
  resolveAuthProfileOrder,
} from "./auth-profiles.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./defaults.js";
import {
  coerceToFailoverError,
  describeFailoverError,
  isFailoverError,
  isTimeoutError,
} from "./failover-error.js";
import {
  buildModelAliasIndex,
  modelKey,
  parseModelRef,
  resolveConfiguredModelRef,
  resolveModelRefFromString,
} from "./model-selection.js";
import { checkOllamaAvailability, checkGeminiAvailability } from "./models-config.providers.js";

type ModelCandidate = {
  provider: string;
  model: string;
};

type FallbackAttempt = {
  provider: string;
  model: string;
  error: string;
  reason?: FailoverReason;
  status?: number;
  code?: string;
};

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  if (isFailoverError(err)) {
    return false;
  }
  const name = "name" in err ? String(err.name) : "";
  // Only treat explicit AbortError names as user aborts.
  // Message-based checks (e.g., "aborted") can mask timeouts and skip fallback.
  return name === "AbortError";
}

function shouldRethrowAbort(err: unknown): boolean {
  return isAbortError(err) && !isTimeoutError(err);
}

function buildAllowedModelKeys(
  cfg: OpenClawConfig | undefined,
  defaultProvider: string,
): Set<string> | null {
  const rawAllowlist = (() => {
    const modelMap = cfg?.agents?.defaults?.models ?? {};
    return Object.keys(modelMap);
  })();
  if (rawAllowlist.length === 0) {
    return null;
  }
  const keys = new Set<string>();
  for (const raw of rawAllowlist) {
    const parsed = parseModelRef(String(raw ?? ""), defaultProvider);
    if (!parsed) {
      continue;
    }
    keys.add(modelKey(parsed.provider, parsed.model));
  }
  return keys.size > 0 ? keys : null;
}

function resolveImageFallbackCandidates(params: {
  cfg: OpenClawConfig | undefined;
  defaultProvider: string;
  modelOverride?: string;
}): ModelCandidate[] {
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg ?? {},
    defaultProvider: params.defaultProvider,
  });
  const allowlist = buildAllowedModelKeys(params.cfg, params.defaultProvider);
  const seen = new Set<string>();
  const candidates: ModelCandidate[] = [];

  const addCandidate = (candidate: ModelCandidate, enforceAllowlist: boolean) => {
    if (!candidate.provider || !candidate.model) {
      return;
    }
    const key = modelKey(candidate.provider, candidate.model);
    if (seen.has(key)) {
      return;
    }
    if (enforceAllowlist && allowlist && !allowlist.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(candidate);
  };

  const addRaw = (raw: string, enforceAllowlist: boolean) => {
    const resolved = resolveModelRefFromString({
      raw: String(raw ?? ""),
      defaultProvider: params.defaultProvider,
      aliasIndex,
    });
    if (!resolved) {
      return;
    }
    addCandidate(resolved.ref, enforceAllowlist);
  };

  if (params.modelOverride?.trim()) {
    addRaw(params.modelOverride, false);
  } else {
    const imageModel = params.cfg?.agents?.defaults?.imageModel as
      | { primary?: string }
      | string
      | undefined;
    const primary = typeof imageModel === "string" ? imageModel.trim() : imageModel?.primary;
    if (primary?.trim()) {
      addRaw(primary, false);
    }
  }

  const imageFallbacks = (() => {
    const imageModel = params.cfg?.agents?.defaults?.imageModel as
      | { fallbacks?: string[] }
      | string
      | undefined;
    if (imageModel && typeof imageModel === "object") {
      return imageModel.fallbacks ?? [];
    }
    return [];
  })();

  for (const raw of imageFallbacks) {
    addRaw(raw, true);
  }

  return candidates;
}

async function resolveFallbackCandidates(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  model: string;
  /** Optional explicit fallbacks list; when provided (even empty), replaces agents.defaults.model.fallbacks. */
  fallbacksOverride?: string[];
}): Promise<ModelCandidate[]> {
  const primary = params.cfg
    ? resolveConfiguredModelRef({
        cfg: params.cfg,
        defaultProvider: DEFAULT_PROVIDER,
        defaultModel: DEFAULT_MODEL,
      })
    : null;
  const defaultProvider = primary?.provider ?? DEFAULT_PROVIDER;
  const defaultModel = primary?.model ?? DEFAULT_MODEL;
  const provider = String(params.provider ?? "").trim() || defaultProvider;
  const model = String(params.model ?? "").trim() || defaultModel;
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg ?? {},
    defaultProvider,
  });
  const allowlist = buildAllowedModelKeys(params.cfg, defaultProvider);
  const seen = new Set<string>();
  const candidates: ModelCandidate[] = [];

  const addCandidate = (candidate: ModelCandidate, enforceAllowlist: boolean) => {
    if (!candidate.provider || !candidate.model) {
      return;
    }
    const key = modelKey(candidate.provider, candidate.model);
    if (seen.has(key)) {
      return;
    }
    if (enforceAllowlist && allowlist && !allowlist.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(candidate);
  };

  addCandidate({ provider, model }, false);

  const modelFallbacks = (() => {
    if (params.fallbacksOverride !== undefined) {
      return params.fallbacksOverride;
    }
    const model = params.cfg?.agents?.defaults?.model as
      | { fallbacks?: string[] }
      | string
      | undefined;
    if (model && typeof model === "object") {
      return model.fallbacks ?? [];
    }
    return [];
  })();

  for (const raw of modelFallbacks) {
    const resolved = resolveModelRefFromString({
      raw: String(raw ?? ""),
      defaultProvider,
      aliasIndex,
    });
    if (!resolved) {
      continue;
    }
    addCandidate(resolved.ref, true);
  }

  if (params.fallbacksOverride === undefined && primary?.provider && primary.model) {
    addCandidate({ provider: primary.provider, model: primary.model }, false);
  }

  // Auto-add Gemini to fallbacks if enabled and available (before Ollama)
  const geminiConfig = params.cfg?.agents?.defaults?.geminiFallback;
  const geminiEnabled = geminiConfig?.enabled !== false; // Default: true
  const geminiAutoAdd = geminiConfig?.autoAdd !== false; // Default: true
  const geminiPriority = geminiConfig?.priority ?? -1; // Default: -1 (before Ollama)
  const geminiPreferredModel = geminiConfig?.preferredModel;

  if (
    geminiEnabled &&
    geminiAutoAdd &&
    params.fallbacksOverride === undefined && // Don't auto-add if user explicitly set fallbacks
    candidates.length > 0 // Only add if we have candidates
  ) {
    try {
      const geminiAvailability = await checkGeminiAvailability({
        preferredModel: geminiPreferredModel,
        preferCli: true, // Prefer CLI over API
      });
      if (geminiAvailability.available && geminiAvailability.preferredModel) {
        // Use gemini-cli if CLI is available, otherwise use google API
        const provider = geminiAvailability.useCli ? "gemini-cli" : "google";
        const geminiCandidate: ModelCandidate = {
          provider,
          model: geminiAvailability.preferredModel,
        };
        const geminiKey = modelKey(geminiCandidate.provider, geminiCandidate.model);

        // Only add if not already in the list
        if (!seen.has(geminiKey)) {
          if (geminiPriority === -1) {
            // Append to end (default)
            addCandidate(geminiCandidate, true);
            console.log(
              `[gemini-fallback] Auto-added Gemini (${geminiCandidate.model}) to fallback chain (position: last)`,
            );
          } else if (geminiPriority === 0) {
            // Prepend to start (after primary)
            candidates.splice(1, 0, geminiCandidate);
            seen.add(geminiKey);
            console.log(
              `[gemini-fallback] Auto-added Gemini (${geminiCandidate.model}) to fallback chain (position: first)`,
            );
          } else if (geminiPriority > 0) {
            // Insert at specific index
            const insertIndex = Math.min(geminiPriority + 1, candidates.length);
            candidates.splice(insertIndex, 0, geminiCandidate);
            seen.add(geminiKey);
            console.log(
              `[gemini-fallback] Auto-added Gemini (${geminiCandidate.model}) to fallback chain (position: ${insertIndex})`,
            );
          } else {
            // Negative but not -1: insert from end
            const insertIndex = Math.max(0, candidates.length + geminiPriority + 1);
            candidates.splice(insertIndex, 0, geminiCandidate);
            seen.add(geminiKey);
            console.log(
              `[gemini-fallback] Auto-added Gemini (${geminiCandidate.model}) to fallback chain (position: ${insertIndex})`,
            );
          }
        }
      } else if (geminiEnabled && geminiAutoAdd) {
        // Provide more helpful error message
        try {
          const { execSync } = await import("node:child_process");
          execSync("which gemini", { stdio: "ignore" });
          console.log(
            `[gemini-fallback] Gemini CLI is available but checkGeminiAvailability returned false (this should not happen)`,
          );
        } catch {
          // CLI not found - check if API key is available as fallback
          const apiKey = process.env.GEMINI_API_KEY;
          if (apiKey) {
            console.log(
              `[gemini-fallback] Gemini CLI not found, but GEMINI_API_KEY is set - will use API instead`,
            );
          } else {
            console.log(
              `[gemini-fallback] Gemini not available: CLI not found and GEMINI_API_KEY not set. Install Gemini CLI (npm install -g @google/gemini-cli) or set GEMINI_API_KEY`,
            );
          }
        }
      }
    } catch (error) {
      // Silently fail availability check - don't block fallback chain
      if (geminiEnabled && geminiAutoAdd) {
        console.log(`[gemini-fallback] Failed to check Gemini availability: ${String(error)}`);
      }
    }
  }

  // Auto-add Ollama to fallbacks if enabled and available (after Gemini)
  const ollamaConfig = params.cfg?.agents?.defaults?.ollamaFallback;
  const ollamaEnabled = ollamaConfig?.enabled !== false; // Default: true
  const ollamaAutoAdd = ollamaConfig?.autoAdd !== false; // Default: true
  const ollamaPriority = ollamaConfig?.priority ?? -1; // Default: -1 (after Gemini)

  if (
    ollamaEnabled &&
    ollamaAutoAdd &&
    params.fallbacksOverride === undefined && // Don't auto-add if user explicitly set fallbacks
    candidates.length > 0 // Only add if we have candidates
  ) {
    try {
      const ollamaAvailability = await checkOllamaAvailability();
      if (ollamaAvailability.available && ollamaAvailability.preferredModel) {
        const ollamaCandidate: ModelCandidate = {
          provider: "ollama",
          model: ollamaAvailability.preferredModel,
        };
        const ollamaKey = modelKey(ollamaCandidate.provider, ollamaCandidate.model);

        // Only add if not already in the list
        if (!seen.has(ollamaKey)) {
          if (ollamaPriority === -1) {
            // Append to end (default)
            addCandidate(ollamaCandidate, true);
            console.log(
              `[ollama-fallback] Auto-added Ollama (${ollamaCandidate.model}) to fallback chain (position: last)`,
            );
          } else if (ollamaPriority === 0) {
            // Prepend to start (after primary)
            candidates.splice(1, 0, ollamaCandidate);
            seen.add(ollamaKey);
            console.log(
              `[ollama-fallback] Auto-added Ollama (${ollamaCandidate.model}) to fallback chain (position: first)`,
            );
          } else if (ollamaPriority > 0) {
            // Insert at specific index
            const insertIndex = Math.min(ollamaPriority + 1, candidates.length);
            candidates.splice(insertIndex, 0, ollamaCandidate);
            seen.add(ollamaKey);
            console.log(
              `[ollama-fallback] Auto-added Ollama (${ollamaCandidate.model}) to fallback chain (position: ${insertIndex})`,
            );
          } else {
            // Negative but not -1: insert from end
            const insertIndex = Math.max(0, candidates.length + ollamaPriority + 1);
            candidates.splice(insertIndex, 0, ollamaCandidate);
            seen.add(ollamaKey);
            console.log(
              `[ollama-fallback] Auto-added Ollama (${ollamaCandidate.model}) to fallback chain (position: ${insertIndex})`,
            );
          }
        }
      } else if (ollamaEnabled && ollamaAutoAdd) {
        console.log(
          `[ollama-fallback] Ollama auto-add enabled but Ollama is not available (available: ${ollamaAvailability.available})`,
        );
      }
    } catch (error) {
      // Silently fail availability check - don't block fallback chain
      // Error is already logged in checkOllamaAvailability
      if (ollamaEnabled && ollamaAutoAdd) {
        console.log(`[ollama-fallback] Failed to check Ollama availability: ${String(error)}`);
      }
    }
  }

  return candidates;
}

export async function runWithModelFallback<T>(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  model: string;
  agentDir?: string;
  /** Optional explicit fallbacks list; when provided (even empty), replaces agents.defaults.model.fallbacks. */
  fallbacksOverride?: string[];
  run: (provider: string, model: string) => Promise<T>;
  onError?: (attempt: {
    provider: string;
    model: string;
    error: unknown;
    attempt: number;
    total: number;
  }) => void | Promise<void>;
}): Promise<{
  result: T;
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
}> {
  const candidates = await resolveFallbackCandidates({
    cfg: params.cfg,
    provider: params.provider,
    model: params.model,
    fallbacksOverride: params.fallbacksOverride,
  });
  const authStore = params.cfg
    ? ensureAuthProfileStore(params.agentDir, { allowKeychainPrompt: false })
    : null;
  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];

    // Lightweight health check for Ollama before attempting
    if (candidate.provider === "ollama") {
      try {
        const ollamaAvailability = await checkOllamaAvailability();
        if (!ollamaAvailability.available) {
          attempts.push({
            provider: candidate.provider,
            model: candidate.model,
            error: "Ollama is not available (server not running or no models found)",
            reason: "timeout",
          });
          continue;
        }
        // Update model to preferred if different (in case availability changed)
        if (
          ollamaAvailability.preferredModel &&
          ollamaAvailability.preferredModel !== candidate.model
        ) {
          candidate.model = ollamaAvailability.preferredModel;
        }
      } catch (error) {
        // If availability check fails, still attempt the call (might be transient)
        // The actual call will fail if Ollama is truly unavailable
      }
    }

    // Lightweight health check for Gemini CLI before attempting
    if (candidate.provider === "gemini-cli") {
      try {
        const geminiAvailability = await checkGeminiAvailability({
          preferCli: true,
        });
        if (!geminiAvailability.available || !geminiAvailability.useCli) {
          attempts.push({
            provider: candidate.provider,
            model: candidate.model,
            error: "Gemini CLI is not available (command not found on PATH)",
            reason: "timeout",
          });
          continue;
        }
        // Update model to preferred if different (in case availability changed)
        if (
          geminiAvailability.preferredModel &&
          geminiAvailability.preferredModel !== candidate.model
        ) {
          candidate.model = geminiAvailability.preferredModel;
        }
      } catch (error) {
        // If availability check fails, still attempt the call (might be transient)
        // The actual call will fail if Gemini CLI is truly unavailable
      }
    }

    if (authStore) {
      const profileIds = resolveAuthProfileOrder({
        cfg: params.cfg,
        store: authStore,
        provider: candidate.provider,
      });
      const isAnyProfileAvailable = profileIds.some((id) => !isProfileInCooldown(authStore, id));

      if (profileIds.length > 0 && !isAnyProfileAvailable) {
        // All profiles for this provider are in cooldown; skip without attempting
        attempts.push({
          provider: candidate.provider,
          model: candidate.model,
          error: `Provider ${candidate.provider} is in cooldown (all profiles unavailable)`,
          reason: "rate_limit",
        });
        continue;
      }
    }
    try {
      const result = await params.run(candidate.provider, candidate.model);
      return {
        result,
        provider: candidate.provider,
        model: candidate.model,
        attempts,
      };
    } catch (err) {
      if (shouldRethrowAbort(err)) {
        throw err;
      }
      const normalized =
        coerceToFailoverError(err, {
          provider: candidate.provider,
          model: candidate.model,
        }) ?? err;
      if (!isFailoverError(normalized)) {
        throw err;
      }

      lastError = normalized;
      const described = describeFailoverError(normalized);
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: described.message,
        reason: described.reason,
        status: described.status,
        code: described.code,
      });
      await params.onError?.({
        provider: candidate.provider,
        model: candidate.model,
        error: normalized,
        attempt: i + 1,
        total: candidates.length,
      });
    }
  }

  if (attempts.length <= 1 && lastError) {
    throw lastError;
  }
  const summary =
    attempts.length > 0
      ? attempts
          .map(
            (attempt) =>
              `${attempt.provider}/${attempt.model}: ${attempt.error}${
                attempt.reason ? ` (${attempt.reason})` : ""
              }`,
          )
          .join(" | ")
      : "unknown";
  throw new Error(`All models failed (${attempts.length || candidates.length}): ${summary}`, {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}

export async function runWithImageModelFallback<T>(params: {
  cfg: OpenClawConfig | undefined;
  modelOverride?: string;
  run: (provider: string, model: string) => Promise<T>;
  onError?: (attempt: {
    provider: string;
    model: string;
    error: unknown;
    attempt: number;
    total: number;
  }) => void | Promise<void>;
}): Promise<{
  result: T;
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
}> {
  const candidates = resolveImageFallbackCandidates({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
    modelOverride: params.modelOverride,
  });
  if (candidates.length === 0) {
    throw new Error(
      "No image model configured. Set agents.defaults.imageModel.primary or agents.defaults.imageModel.fallbacks.",
    );
  }

  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    try {
      const result = await params.run(candidate.provider, candidate.model);
      return {
        result,
        provider: candidate.provider,
        model: candidate.model,
        attempts,
      };
    } catch (err) {
      if (shouldRethrowAbort(err)) {
        throw err;
      }
      lastError = err;
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: err instanceof Error ? err.message : String(err),
      });
      await params.onError?.({
        provider: candidate.provider,
        model: candidate.model,
        error: err,
        attempt: i + 1,
        total: candidates.length,
      });
    }
  }

  if (attempts.length <= 1 && lastError) {
    throw lastError;
  }
  const summary =
    attempts.length > 0
      ? attempts
          .map((attempt) => `${attempt.provider}/${attempt.model}: ${attempt.error}`)
          .join(" | ")
      : "unknown";
  throw new Error(`All image models failed (${attempts.length || candidates.length}): ${summary}`, {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}
