import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { MemoryCitationsMode } from "../../config/types.memory.js";
import type { ContextBudget } from "../context-budget.js";
import type { ResolvedTimeFormat } from "../date-time.js";
import type { EmbeddedContextFile } from "../pi-embedded-helpers.js";
import type { EmbeddedSandboxInfo } from "./types.js";
import type { ReasoningLevel, ThinkLevel } from "./utils.js";
import {
  buildVersionedSystemPrompt,
  type SessionPromptInfo,
} from "../prompts/session-attribution.js";
import { buildAgentSystemPrompt, type PromptMode } from "../system-prompt.js";
import { buildToolSummaryMap } from "../tool-summaries.js";

/**
 * Calculate task complexity based on various characteristics of the user prompt
 * @param prompt The user's request/prompt
 * @returns Complexity score between 0.0 and 1.0
 */
function calculateTaskComplexity(prompt: string): number {
  if (!prompt || typeof prompt !== "string") {
    return 0.0;
  }

  const text = prompt.toLowerCase().trim();
  let complexity = 0.0;

  // Base complexity from prompt length
  const lengthScore = Math.min(text.length / 1000, 0.3);
  complexity += lengthScore;

  // Multi-step indicators
  const multiStepKeywords = [
    "then",
    "after",
    "next",
    "first",
    "second",
    "finally",
    "steps",
    "process",
  ];
  const multiStepMatches = multiStepKeywords.filter((kw) => text.includes(kw)).length;
  complexity += Math.min(multiStepMatches * 0.1, 0.2);

  // Technical complexity indicators
  const technicalKeywords = [
    "implement",
    "create",
    "build",
    "develop",
    "configure",
    "setup",
    "deploy",
    "architecture",
    "database",
    "api",
    "integration",
  ];
  const technicalMatches = technicalKeywords.filter((kw) => text.includes(kw)).length;
  complexity += Math.min(technicalMatches * 0.08, 0.25);

  // Multiple tool/domain indicators
  const toolDomains = [
    "file",
    "code",
    "web",
    "browser",
    "message",
    "memory",
    "exec",
    "search",
    "analysis",
  ];
  const domainMatches = toolDomains.filter((domain) => text.includes(domain)).length;
  complexity += Math.min(domainMatches * 0.05, 0.15);

  // Problem-solving indicators
  const problemKeywords = [
    "debug",
    "fix",
    "solve",
    "analyze",
    "investigate",
    "troubleshoot",
    "research",
  ];
  const problemMatches = problemKeywords.filter((kw) => text.includes(kw)).length;
  complexity += Math.min(problemMatches * 0.1, 0.2);

  // Complex reasoning indicators
  const reasoningKeywords = [
    "compare",
    "evaluate",
    "decide",
    "optimize",
    "strategy",
    "plan",
    "design",
  ];
  const reasoningMatches = reasoningKeywords.filter((kw) => text.includes(kw)).length;
  complexity += Math.min(reasoningMatches * 0.08, 0.15);

  // Multiple entity/target indicators
  const entityCount = (text.match(/\b(for|with|to|from)\s+\w+/g) || []).length;
  complexity += Math.min(entityCount * 0.03, 0.1);

  // Question complexity (multiple questions indicate complex task)
  const questionCount = (text.match(/\?/g) || []).length;
  if (questionCount > 1) {
    complexity += Math.min(questionCount * 0.05, 0.15);
  }

  // Ensure complexity is within bounds
  return Math.min(Math.max(complexity, 0.0), 1.0);
}

export async function buildEmbeddedSystemPrompt(params: {
  workspaceDir: string;
  defaultThinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  reasoningTagHint: boolean;
  heartbeatPrompt?: string;
  skillsPrompt?: string;
  docsPath?: string;
  ttsHint?: string;
  reactionGuidance?: {
    level: "minimal" | "extensive";
    channel: string;
  };
  workspaceNotes?: string[];
  /** Controls which hardcoded sections to include. Defaults to "full". */
  promptMode?: PromptMode;
  runtimeInfo: {
    agentId?: string;
    host: string;
    os: string;
    arch: string;
    node: string;
    model: string;
    provider?: string;
    capabilities?: string[];
    channel?: string;
    /** Supported message actions for the current channel (e.g., react, edit, unsend) */
    channelActions?: string[];
  };
  messageToolHints?: string[];
  sandboxInfo?: EmbeddedSandboxInfo;
  tools: AgentTool[];
  modelAliasLines: string[];
  userTimezone: string;
  userTime?: string;
  userTimeFormat?: ResolvedTimeFormat;
  contextFiles?: EmbeddedContextFile[];
  memoryCitationsMode?: MemoryCitationsMode;
  sessionKey?: string;
  /** FSM state for Quake Bot integration */
  fsmState?: string;
  /** Goal stack summary for Quake Bot integration */
  goalStackSummary?: string;
  /** Active tool clusters for Quake Bot integration */
  activeClusters?: string[];
  /** Context budget for FSM-aware section filtering */
  contextBudget?: ContextBudget;
  /** User prompt for distillation analysis */
  userPrompt?: string;
}): Promise<{ prompt: string; promptInfo: SessionPromptInfo }> {
  const basePrompt = await buildAgentSystemPrompt({
    workspaceDir: params.workspaceDir,
    defaultThinkLevel: params.defaultThinkLevel,
    reasoningLevel: params.reasoningLevel,
    extraSystemPrompt: params.extraSystemPrompt,
    ownerNumbers: params.ownerNumbers,
    reasoningTagHint: params.reasoningTagHint,
    heartbeatPrompt: params.heartbeatPrompt,
    skillsPrompt: params.skillsPrompt,
    docsPath: params.docsPath,
    ttsHint: params.ttsHint,
    workspaceNotes: params.workspaceNotes,
    reactionGuidance: params.reactionGuidance,
    promptMode: params.promptMode,
    runtimeInfo: params.runtimeInfo,
    messageToolHints: params.messageToolHints,
    sandboxInfo: params.sandboxInfo,
    toolNames: params.tools.map((tool) => tool.name),
    toolSummaries: buildToolSummaryMap(params.tools),
    modelAliasLines: params.modelAliasLines,
    userTimezone: params.userTimezone,
    userTime: params.userTime,
    userTimeFormat: params.userTimeFormat,
    contextFiles: params.contextFiles,
    memoryCitationsMode: params.memoryCitationsMode,
    // Pass through Quake Bot integration params
    fsmState: params.fsmState,
    goalStackSummary: params.goalStackSummary,
    activeClusters: params.activeClusters,
    contextBudget: params.contextBudget,
  });

  // Apply distillation prompt injection for complex tasks (non-blocking, falls back gracefully)
  // Token budget: ~4 chars per token, leave headroom for conversation
  const MAX_PROMPT_CHARS = 150000; // ~37.5k tokens for system prompt
  const MAX_FEWSHOT_CHARS = 4000; // ~1k tokens for few-shot examples

  let fewShotPrompt = basePrompt;
  try {
    // Skip injection if base prompt is already too large
    if (basePrompt.length > MAX_PROMPT_CHARS) {
      console.log(
        `[distillation] Skipping injection - base prompt already ${(basePrompt.length / 1000).toFixed(1)}k chars`,
      );
    } else if (params.userPrompt && params.userPrompt.trim()) {
      const { getDistillationSystem } = await import("../evolution/algorithm-distillation.js");

      // Determine task complexity based on prompt characteristics
      const taskComplexity = calculateTaskComplexity(params.userPrompt);
      console.log(
        `[distillation] Task complexity: ${taskComplexity.toFixed(2)} for prompt: "${params.userPrompt.slice(0, 100)}..."`,
      );

      // Inject few-shot examples for complex tasks
      if (taskComplexity > 0.7) {
        const distillation = await getDistillationSystem(params.workspaceDir);
        const fewShotExamples = await distillation.generateFewShotPrompt(params.userPrompt);

        if (fewShotExamples) {
          // Enforce token budget on few-shot content
          const truncatedExamples =
            fewShotExamples.length > MAX_FEWSHOT_CHARS
              ? fewShotExamples.slice(0, MAX_FEWSHOT_CHARS) + "\n\n*[truncated for context budget]*"
              : fewShotExamples;

          // Inject examples before the final sections of the system prompt
          const promptLines = fewShotPrompt.split("\n");
          const runtimeSectionIndex = promptLines.findIndex((line) =>
            line.startsWith("## Runtime"),
          );
          const insertIndex =
            runtimeSectionIndex >= 0 ? runtimeSectionIndex : promptLines.length - 1;

          promptLines.splice(insertIndex, 0, "", truncatedExamples, "");
          fewShotPrompt = promptLines.join("\n");

          console.log(
            `[distillation] Injected few-shot examples for complex task (complexity: ${taskComplexity.toFixed(2)}, ${truncatedExamples.length} chars)`,
          );
        } else {
          console.log(`[distillation] No patterns available for task type, using base prompt`);
        }
      }
    }
  } catch (error) {
    console.warn("[distillation] Failed to apply few-shot injection:", error);
    // Graceful degradation - use base prompt
  }

  // Apply evolution genotype modifications (non-blocking, falls back gracefully)
  let finalPrompt = fewShotPrompt;
  try {
    const { applyCurrentGenotypeToPrompt } = await import("../evolution/integration.js");
    finalPrompt = await applyCurrentGenotypeToPrompt(fewShotPrompt);
  } catch {
    // Evolution module not available or failed to load - use few-shot prompt
  }

  // Apply prompt versioning and A/B testing (non-blocking, falls back gracefully)
  try {
    return await buildVersionedSystemPrompt(finalPrompt, params.sessionKey, {
      author: "system",
      rationale: "Auto-generated system prompt",
    });
  } catch (error) {
    console.warn("Failed to apply prompt versioning:", error);
    // Fallback: return unversioned prompt with basic info
    return {
      prompt: finalPrompt,
      promptInfo: {
        system: {
          id: "fallback",
          name: "system-main",
          hash: "fallback",
        },
      },
    };
  }
}

export function createSystemPromptOverride(
  systemPrompt: string,
): (defaultPrompt?: string) => string {
  const override = (typeof systemPrompt === "string" ? systemPrompt : "").trim();
  return (_defaultPrompt?: string) => override;
}

export function applySystemPromptOverrideToSession(
  session: AgentSession,
  override: string | ((defaultPrompt?: string) => string),
) {
  const prompt = typeof override === "function" ? override() : override.trim();
  session.agent.setSystemPrompt(prompt);
  const mutableSession = session as unknown as {
    _baseSystemPrompt?: string;
    _rebuildSystemPrompt?: (toolNames: string[]) => string;
  };
  mutableSession._baseSystemPrompt = prompt;
  mutableSession._rebuildSystemPrompt = () => prompt;
}
