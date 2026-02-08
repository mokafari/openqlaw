/**
 * Session Orchestrator - Multi-Agent Deliberation System
 *
 * Implements the devil's advocate pattern for complex decisions by spawning
 * multiple agents with different roles (executor, critic, reviewer) and
 * synthesizing their responses into a consensus decision.
 *
 * @module session-orchestrator
 */

import crypto from "node:crypto";
import type { AgentRole } from "./tools/sessions-spawn-tool.js";
import { callGateway } from "../gateway/call.js";

/**
 * Options for spawning an agent with a specific role
 */
export interface SpawnRoleOptions {
  task: string;
  role: AgentRole;
  label?: string;
  agentId?: string;
  model?: string;
  thinking?: string;
  runTimeoutSeconds?: number;
}

/**
 * Result from a single agent's deliberation
 */
export interface AgentDeliberationResult {
  role: AgentRole;
  runId: string;
  sessionKey: string;
  response: string;
  status: "ok" | "error" | "timeout";
  error?: string;
  durationMs?: number;
}

/**
 * Synthesized deliberation outcome
 */
export interface DeliberationOutcome {
  /** Whether consensus was reached */
  consensusReached: boolean;

  /** The agreed decision/approach (if consensus reached) */
  decision?: string;

  /** Individual agent results */
  agentResults: AgentDeliberationResult[];

  /** Summary of conflicts between agents */
  conflicts: ConflictSummary[];

  /** Majority vote outcome */
  majorityVote: "proceed" | "reject" | "needs_review";

  /** Dissenting opinions that disagreed with majority */
  dissentingOpinions: DissentingOpinion[];

  /** Total deliberation time */
  totalDurationMs: number;
}

/**
 * A conflict between agent opinions
 */
export interface ConflictSummary {
  /** Topic of disagreement */
  topic: string;
  /** Roles that disagree */
  disagreingRoles: AgentRole[];
  /** Brief description of the conflict */
  description: string;
  /** Severity level */
  severity: "critical" | "moderate" | "minor";
}

/**
 * A dissenting opinion from an agent
 */
export interface DissentingOpinion {
  role: AgentRole;
  opinion: string;
  reasons: string[];
}

/**
 * Options for the deliberate function
 */
export interface DeliberateOptions {
  /** Roles to spawn for deliberation (default: executor + critic) */
  roles?: AgentRole[];

  /** Whether consensus is required before proceeding */
  requiresConsensus?: boolean;

  /** Timeout for each agent in seconds */
  agentTimeoutSeconds?: number;

  /** Optional agent ID to use */
  agentId?: string;

  /** Optional model to use */
  model?: string;

  /** Callback for human confirmation when consensus fails */
  onConflict?: (outcome: DeliberationOutcome) => Promise<"proceed" | "abort">;
}

/**
 * Spawn an agent with a specific role via the gateway
 */
async function spawnAgentWithRole(
  opts: SpawnRoleOptions,
  requesterSessionKey: string,
): Promise<{ runId: string; sessionKey: string }> {
  const childSessionKey = `agent:deliberation:${opts.role}:${crypto.randomUUID()}`;

  const response = await callGateway<{ runId: string }>({
    method: "agent",
    params: {
      message: opts.task,
      sessionKey: childSessionKey,
      idempotencyKey: crypto.randomUUID(),
      deliver: false,
      lane: "subagent",
      // The role is passed through the spawn which modifies the system prompt
      role: opts.role,
      timeout: opts.runTimeoutSeconds ?? 300,
      label: opts.label ?? `Deliberation (${opts.role})`,
      spawnedBy: requesterSessionKey,
    },
    timeoutMs: 10_000,
  });

  return {
    runId: response?.runId ?? crypto.randomUUID(),
    sessionKey: childSessionKey,
  };
}

/**
 * Wait for an agent run to complete and get the result
 */
async function waitForAgentResult(
  runId: string,
  sessionKey: string,
  role: AgentRole,
  timeoutMs: number,
): Promise<AgentDeliberationResult> {
  const startTime = Date.now();

  try {
    const wait = await callGateway<{
      status?: string;
      error?: string;
    }>({
      method: "agent.wait",
      params: {
        runId,
        timeoutMs,
      },
      timeoutMs: timeoutMs + 5000,
    });

    // Get the response from the session
    const reply = await callGateway<{ content?: string }>({
      method: "sessions.getLatestReply",
      params: { key: sessionKey },
      timeoutMs: 5000,
    });

    const durationMs = Date.now() - startTime;

    if (wait?.status === "timeout") {
      return {
        role,
        runId,
        sessionKey,
        response: reply?.content ?? "",
        status: "timeout",
        durationMs,
      };
    }

    if (wait?.status === "error") {
      return {
        role,
        runId,
        sessionKey,
        response: reply?.content ?? "",
        status: "error",
        error: wait.error,
        durationMs,
      };
    }

    return {
      role,
      runId,
      sessionKey,
      response: reply?.content ?? "",
      status: "ok",
      durationMs,
    };
  } catch (err) {
    return {
      role,
      runId,
      sessionKey,
      response: "",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Analyze responses to identify conflicts between agents
 */
function analyzeConflicts(results: AgentDeliberationResult[]): ConflictSummary[] {
  const conflicts: ConflictSummary[] = [];

  // Look for explicit rejection markers in critic responses
  const criticResult = results.find((r) => r.role === "critic");
  if (criticResult?.response) {
    const response = criticResult.response.toLowerCase();

    // First check if critic explicitly approved - if so, no conflicts
    const isApproval =
      response.includes("approve") ||
      response.includes("no significant issues") ||
      response.includes("looks good") ||
      response.includes("no issues found");

    // Only flag critical conflicts if NOT an approval
    if (!isApproval) {
      // Check for critical issues
      if (
        response.includes("critical") ||
        response.includes("reject") ||
        response.includes("do not proceed")
      ) {
        conflicts.push({
          topic: "Approach validity",
          disagreingRoles: ["executor", "critic"],
          description: "Critic identified critical issues with the proposed approach",
          severity: "critical",
        });
      }

      // Check for security concerns
      if (
        response.includes("security") ||
        response.includes("vulnerability") ||
        response.includes("unsafe")
      ) {
        conflicts.push({
          topic: "Security",
          disagreingRoles: ["executor", "critic"],
          description: "Critic raised security concerns",
          severity: "critical",
        });
      }

      // Check for moderate concerns
      if (
        response.includes("concern") ||
        response.includes("issue") ||
        response.includes("problem")
      ) {
        if (!conflicts.some((c) => c.severity === "critical")) {
          conflicts.push({
            topic: "Implementation concerns",
            disagreingRoles: ["executor", "critic"],
            description: "Critic raised concerns about the implementation",
            severity: "moderate",
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Determine the majority vote based on agent responses
 */
function determineMajorityVote(
  results: AgentDeliberationResult[],
): "proceed" | "reject" | "needs_review" {
  let proceedVotes = 0;
  let rejectVotes = 0;

  for (const result of results) {
    if (result.status !== "ok") {
      rejectVotes++; // Errors/timeouts count as reject
      continue;
    }

    const response = result.response.toLowerCase();

    if (result.role === "executor") {
      // Executors implicitly vote proceed by completing the task
      proceedVotes++;
    } else if (result.role === "critic") {
      // Analyze critic's verdict
      if (
        response.includes("approve") ||
        response.includes("no significant issues") ||
        response.includes("looks good")
      ) {
        proceedVotes++;
      } else if (response.includes("reject") || response.includes("critical")) {
        rejectVotes++;
      } else {
        // Default to needs_review for ambiguous responses
        return "needs_review";
      }
    } else if (result.role === "reviewer") {
      // Check reviewer's quality assessment
      const scoreMatch = response.match(/quality\s*score[:\s]*(\d+)/i);
      if (scoreMatch) {
        const score = parseInt(scoreMatch[1], 10);
        if (score >= 7) proceedVotes++;
        else if (score <= 4) rejectVotes++;
        else return "needs_review";
      } else if (response.includes("production-ready") || response.includes("complete")) {
        proceedVotes++;
      } else if (response.includes("incomplete") || response.includes("not ready")) {
        rejectVotes++;
      }
    }
  }

  if (rejectVotes > 0 && rejectVotes >= proceedVotes) {
    return "reject";
  }
  if (proceedVotes > rejectVotes) {
    return "proceed";
  }
  return "needs_review";
}

/**
 * Extract dissenting opinions from agent results
 */
function extractDissentingOpinions(
  results: AgentDeliberationResult[],
  majorityVote: "proceed" | "reject" | "needs_review",
): DissentingOpinion[] {
  const dissenting: DissentingOpinion[] = [];

  for (const result of results) {
    if (result.role === "critic" && majorityVote === "proceed") {
      // Extract concerns even when proceeding
      const concerns = extractConcerns(result.response);
      if (concerns.length > 0) {
        dissenting.push({
          role: "critic",
          opinion: "Raised concerns despite approval",
          reasons: concerns,
        });
      }
    }
  }

  return dissenting;
}

/**
 * Extract specific concerns from a response
 */
function extractConcerns(response: string): string[] {
  const concerns: string[] = [];
  const lines = response.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Look for bullet points or numbered items that describe issues
    if (trimmed.match(/^[-*•]\s*/) || trimmed.match(/^\d+\.\s*/)) {
      const content = trimmed.replace(/^[-*•\d.]+\s*/, "");
      if (content.length > 10 && content.length < 200) {
        concerns.push(content);
      }
    }
  }

  return concerns.slice(0, 5); // Limit to 5 concerns
}

/**
 * Synthesize a decision from multiple agent responses
 */
function synthesizeDecision(results: AgentDeliberationResult[]): string | undefined {
  const executorResult = results.find((r) => r.role === "executor" && r.status === "ok");
  if (executorResult) {
    return executorResult.response;
  }
  return undefined;
}

/**
 * Main deliberation function - spawns multiple agents and synthesizes consensus
 *
 * @param task - The task/decision to deliberate on
 * @param requesterSessionKey - Session key of the requesting agent
 * @param options - Deliberation options
 * @returns Synthesized deliberation outcome
 *
 * @example
 * ```typescript
 * const outcome = await deliberate(
 *   "Should we deploy this change to production?",
 *   "agent:main:session-123",
 *   { requiresConsensus: true }
 * );
 *
 * if (outcome.consensusReached) {
 *   console.log("Proceeding with:", outcome.decision);
 * } else {
 *   console.log("Conflicts:", outcome.conflicts);
 * }
 * ```
 */
export async function deliberate(
  task: string,
  requesterSessionKey: string,
  options: DeliberateOptions = {},
): Promise<DeliberationOutcome> {
  const startTime = Date.now();
  const roles = options.roles ?? ["executor", "critic"];
  const timeoutMs = (options.agentTimeoutSeconds ?? 300) * 1000;

  // Spawn all agents in parallel
  const spawnPromises = roles.map((role) =>
    spawnAgentWithRole(
      {
        task,
        role,
        agentId: options.agentId,
        model: options.model,
        runTimeoutSeconds: options.agentTimeoutSeconds,
      },
      requesterSessionKey,
    ).then((spawn) => ({ ...spawn, role })),
  );

  const spawns = await Promise.all(spawnPromises);

  // Wait for all results in parallel
  const resultPromises = spawns.map((spawn) =>
    waitForAgentResult(spawn.runId, spawn.sessionKey, spawn.role, timeoutMs),
  );

  const results = await Promise.all(resultPromises);

  // Analyze the results
  const conflicts = analyzeConflicts(results);
  const majorityVote = determineMajorityVote(results);
  const dissentingOpinions = extractDissentingOpinions(results, majorityVote);
  const decision = synthesizeDecision(results);

  // Determine if consensus was reached
  const hasNoCriticalConflicts = !conflicts.some((c) => c.severity === "critical");
  const allSucceeded = results.every((r) => r.status === "ok");
  const consensusReached = hasNoCriticalConflicts && allSucceeded && majorityVote === "proceed";

  const outcome: DeliberationOutcome = {
    consensusReached,
    decision: consensusReached ? decision : undefined,
    agentResults: results,
    conflicts,
    majorityVote,
    dissentingOpinions,
    totalDurationMs: Date.now() - startTime,
  };

  // If consensus required but not reached, call conflict handler
  if (options.requiresConsensus && !consensusReached && options.onConflict) {
    const resolution = await options.onConflict(outcome);
    if (resolution === "proceed") {
      outcome.consensusReached = true;
      outcome.decision = decision;
    }
  }

  return outcome;
}

/**
 * Quick debate function - spawns executor and critic, returns simple verdict
 *
 * Use this for quick sanity checks on approaches.
 *
 * @param task - The task/approach to evaluate
 * @param requesterSessionKey - Session key of the requesting agent
 * @returns Simple verdict with reasoning
 */
export async function quickDebate(
  task: string,
  requesterSessionKey: string,
): Promise<{
  verdict: "proceed" | "reject" | "needs_review";
  executorSays: string;
  criticSays: string;
  conflicts: ConflictSummary[];
}> {
  const outcome = await deliberate(task, requesterSessionKey, {
    roles: ["executor", "critic"],
    agentTimeoutSeconds: 120,
  });

  return {
    verdict: outcome.majorityVote,
    executorSays: outcome.agentResults.find((r) => r.role === "executor")?.response ?? "",
    criticSays: outcome.agentResults.find((r) => r.role === "critic")?.response ?? "",
    conflicts: outcome.conflicts,
  };
}

/**
 * Create a debate protocol guard for consensus-required operations
 *
 * @param requesterSessionKey - Session key for spawning agents
 * @returns Guard function that enforces debate protocol
 */
export function createDebateGuard(requesterSessionKey: string) {
  return async function debateGuard<T>(
    operation: () => Promise<T>,
    description: string,
    options: { requiresConsensus?: boolean } = {},
  ): Promise<{ result?: T; blocked: boolean; reason?: string; outcome?: DeliberationOutcome }> {
    if (!options.requiresConsensus) {
      const result = await operation();
      return { result, blocked: false };
    }

    const outcome = await deliberate(
      `Evaluate this proposed operation: ${description}`,
      requesterSessionKey,
      { requiresConsensus: true },
    );

    if (!outcome.consensusReached) {
      return {
        blocked: true,
        reason: `Consensus not reached. Conflicts: ${outcome.conflicts.map((c) => c.description).join("; ")}`,
        outcome,
      };
    }

    const result = await operation();
    return { result, blocked: false, outcome };
  };
}
