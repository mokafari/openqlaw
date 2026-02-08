import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { resolveStateDir } from "../../config/paths.js";
import { recordPromptSession } from "../evolution/prompt-metrics.js";
import {
  generatePromptId,
  getCurrentPrompt,
  getPromptForTesting,
  registerPromptVersion,
} from "./registry.js";

export interface SessionPromptInfo {
  system: {
    id: string; // Prompt version ID (SHA256 hash)
    name: string; // Prompt name (e.g., "system-main")
    hash: string; // First 8 chars of ID for display
  };
  diagnostic?: {
    id: string;
    name: string;
    hash: string;
  };
  experimentId?: string; // If session is part of A/B test
}

/**
 * Extract and register prompt from system prompt content.
 * This is called during system prompt generation to track versions.
 */
export async function extractAndRegisterPrompt(params: {
  promptName: string;
  content: string;
  sessionKey?: string;
  author?: string;
  rationale?: string;
}): Promise<SessionPromptInfo> {
  const promptId = generatePromptId(params.content);

  try {
    // Check if this version already exists
    let currentPrompt = await getCurrentPrompt(params.promptName);

    // If this is a new version, register it
    if (!currentPrompt || currentPrompt.id !== promptId) {
      try {
        await registerPromptVersion({
          name: params.promptName,
          content: params.content,
          metadata: {
            author: params.author ?? "system",
            rationale: params.rationale ?? "Automatic registration from session",
            targetBehaviors: ["general-assistance"],
          },
          status: "active",
        });
      } catch (err) {
        // Version may already exist - this is fine for concurrent registrations
        if (!String(err).includes("already exists")) {
          console.warn(`Failed to register prompt version: ${err}`);
        }
      }

      // Refresh the current prompt
      currentPrompt = await getCurrentPrompt(params.promptName);
    }

    // For A/B testing, get the appropriate variant
    let promptVersion = currentPrompt;
    let experimentId: string | undefined;

    if (params.sessionKey) {
      try {
        const testResult = await getPromptForTesting(params.promptName, params.sessionKey);
        promptVersion = testResult.promptVersion;
        experimentId = testResult.experimentId;
      } catch {
        // Fall back to current prompt if A/B testing fails
        promptVersion = currentPrompt;
      }
    }

    if (!promptVersion) {
      throw new Error(`No prompt version found for ${params.promptName}`);
    }

    return {
      system: {
        id: promptVersion.id,
        name: params.promptName,
        hash: promptVersion.id.substring(0, 8),
      },
      experimentId,
    };
  } catch (err) {
    console.warn(`Failed to extract prompt info for ${params.promptName}: ${err}`);

    // Fallback: create basic info from content hash
    return {
      system: {
        id: promptId,
        name: params.promptName,
        hash: promptId.substring(0, 8),
      },
    };
  }
}

/**
 * Hook into buildAgentSystemPrompt to add prompt versioning.
 * This wraps the original prompt with version tracking.
 */
export async function buildVersionedSystemPrompt(
  originalPrompt: string,
  sessionKey?: string,
  additionalInfo?: {
    author?: string;
    rationale?: string;
  },
): Promise<{ prompt: string; promptInfo: SessionPromptInfo }> {
  // Extract the main system prompt
  const promptInfo = await extractAndRegisterPrompt({
    promptName: "system-main",
    content: originalPrompt,
    sessionKey,
    author: additionalInfo?.author,
    rationale: additionalInfo?.rationale,
  });

  // Add version tracking comment to prompt
  const versionedPrompt = addPromptVersionInfo(originalPrompt, promptInfo);

  return {
    prompt: versionedPrompt,
    promptInfo,
  };
}

/**
 * Add version tracking information to the prompt as a comment.
 */
function addPromptVersionInfo(prompt: string, promptInfo: SessionPromptInfo): string {
  const versionComment = [
    `<!-- Prompt Version Info -->`,
    `<!-- System: ${promptInfo.system.name} (${promptInfo.system.id}) -->`,
    promptInfo.experimentId ? `<!-- Experiment: ${promptInfo.experimentId} -->` : "",
    `<!-- Generated: ${new Date().toISOString()} -->`,
    ``,
  ]
    .filter(Boolean)
    .join("\n");

  return versionComment + prompt;
}

/**
 * Record session outcome for prompt metrics.
 * This should be called when a session completes (success or failure).
 */
export async function recordSessionOutcome(params: {
  sessionId: string;
  sessionKey?: string;
  promptInfo: SessionPromptInfo;
  success: boolean;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  durationMs: number;
  errors: string[];
  toolCalls: number;
  model: string;
  provider: string;
  baselineTokens?: number;
}): Promise<void> {
  try {
    await recordPromptSession({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      promptId: params.promptInfo.system.id,
      promptName: params.promptInfo.system.name,
      experimentId: params.promptInfo.experimentId,
      success: params.success,
      tokenUsage: params.tokenUsage,
      durationMs: params.durationMs,
      errors: params.errors,
      toolCalls: params.toolCalls,
      model: params.model,
      provider: params.provider,
      baselineTokens: params.baselineTokens,
    });
  } catch (err) {
    console.warn(`Failed to record session outcome: ${err}`);
  }
}

/**
 * Get prompt info from session metadata or extract from recent session.
 */
export async function getSessionPromptInfo(sessionId: string): Promise<SessionPromptInfo | null> {
  const stateDir = resolveStateDir();
  const sessionPromptPath = path.join(stateDir, "evolution", "prompts", "session_prompts.json");

  try {
    const content = await fs.readFile(sessionPromptPath, "utf-8");
    const sessionPrompts = JSON.parse(content) as Record<string, SessionPromptInfo>;
    return sessionPrompts[sessionId] || null;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Store prompt info for a session (for later retrieval).
 */
export async function storeSessionPromptInfo(
  sessionId: string,
  promptInfo: SessionPromptInfo,
): Promise<void> {
  const stateDir = resolveStateDir();
  const sessionPromptPath = path.join(stateDir, "evolution", "prompts", "session_prompts.json");

  await fs.mkdir(path.dirname(sessionPromptPath), { recursive: true });

  let sessionPrompts: Record<string, SessionPromptInfo> = {};

  try {
    const content = await fs.readFile(sessionPromptPath, "utf-8");
    sessionPrompts = JSON.parse(content);
  } catch (err) {
    if ((err as { code?: string }).code !== "ENOENT") {
      console.warn(`Failed to read session prompts: ${err}`);
    }
  }

  sessionPrompts[sessionId] = promptInfo;

  // Keep only recent sessions (last 10000 to prevent unbounded growth)
  const entries = Object.entries(sessionPrompts);
  if (entries.length > 10000) {
    const recentEntries = entries.slice(-10000);
    sessionPrompts = Object.fromEntries(recentEntries);
  }

  await fs.writeFile(sessionPromptPath, JSON.stringify(sessionPrompts, null, 2), "utf-8");
}

/**
 * Extract errors from session telemetry or agent output.
 */
export function extractSessionErrors(params: {
  agentOutput?: string;
  toolErrors?: Array<{ tool: string; error: string }>;
  systemErrors?: string[];
}): string[] {
  const errors: string[] = [];

  // Add tool errors
  if (params.toolErrors) {
    for (const toolError of params.toolErrors) {
      errors.push(`${toolError.tool}: ${toolError.error}`);
    }
  }

  // Add system errors
  if (params.systemErrors) {
    errors.push(...params.systemErrors);
  }

  // Extract errors from agent output (basic pattern matching)
  if (params.agentOutput) {
    const errorPatterns = [
      /Error: ([^\n]+)/g,
      /ERROR: ([^\n]+)/g,
      /Failed to ([^\n]+)/g,
      /\berror\b[:\-\s]*([^\n]+)/gi,
    ];

    for (const pattern of errorPatterns) {
      const matches = [...params.agentOutput.matchAll(pattern)];
      for (const match of matches) {
        if (match[1]?.trim()) {
          errors.push(match[1].trim());
        }
      }
    }
  }

  return [...new Set(errors)]; // Remove duplicates
}

/**
 * Initialize prompt registry with current system prompt if not already present.
 */
export async function initializePromptRegistry(defaultPrompt: string): Promise<void> {
  try {
    const currentPrompt = await getCurrentPrompt("system-main");

    if (!currentPrompt) {
      // Register the default system prompt as version 1
      await registerPromptVersion({
        name: "system-main",
        content: defaultPrompt,
        metadata: {
          author: "system",
          rationale: "Initial system prompt registration",
          targetBehaviors: ["general-assistance", "tool-usage", "safety-compliance"],
        },
        status: "active",
      });
    }
  } catch (err) {
    console.warn(`Failed to initialize prompt registry: ${err}`);
  }
}

/**
 * Extract baseline token count from system prompt or use default.
 */
export function extractBaselineTokens(prompt: string): number {
  // Simple heuristic: 1 token ≈ 4 characters
  // This is rough but should be sufficient for relative comparisons
  const estimatedTokens = Math.ceil(prompt.length / 4);

  // Default baseline if prompt is too short/long
  return Math.max(1000, Math.min(estimatedTokens, 100000));
}
