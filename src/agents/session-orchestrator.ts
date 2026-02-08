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

// ============================================================================
// HARDENING CONSTANTS
// ============================================================================

/** Maximum concurrent deliberations to prevent resource exhaustion */
const MAX_CONCURRENT_DELIBERATIONS = 5;

/** Maximum recursion depth for nested deliberations */
const MAX_DELIBERATION_DEPTH = 3;

/** Negation patterns to check within proximity of approval keywords */
const NEGATION_PATTERNS = [
  "not ",
  "don't ",
  "dont ",
  "cannot ",
  "can't ",
  "cant ",
  "never ",
  "no ",
];

/** Approval keywords for semantic verdict parsing */
const APPROVAL_KEYWORDS = ["approve", "approved", "approves", "approving"];

/** Prompt injection patterns to detect and reject */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous/i,
  /disregard\s+(all\s+)?instructions/i,
  /forget\s+(all\s+)?previous/i,
  /you\s+are\s+now/i,
  /new\s+instructions?:/i,
  /override\s+(your\s+)?instructions/i,
  /system\s*:\s*you/i,
  /\[system\]/i,
  /pretend\s+(you're|you\s+are)/i,
  /act\s+as\s+if/i,
  /bypass\s+(your\s+)?(safety|security|restrictions)/i,
  /jailbreak/i,
];

// ============================================================================
// DELIBERATION SEMAPHORE
// ============================================================================

interface SemaphoreWaiter {
  resolve: () => void;
  reject: (err: Error) => void;
}

class DeliberationSemaphore {
  private currentCount = 0;
  private readonly maxCount: number;
  private readonly queue: SemaphoreWaiter[] = [];

  constructor(maxConcurrent: number) {
    this.maxCount = maxConcurrent;
  }

  async acquire(): Promise<void> {
    if (this.currentCount < this.maxCount) {
      this.currentCount++;
      return;
    }

    // Queue this request
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ resolve, reject });
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      // Wake up next waiter
      const waiter = this.queue.shift()!;
      waiter.resolve();
    } else {
      this.currentCount = Math.max(0, this.currentCount - 1);
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.currentCount;
  }
}

/** Global semaphore for limiting concurrent deliberations */
const deliberationSemaphore = new DeliberationSemaphore(MAX_CONCURRENT_DELIBERATIONS);

// ============================================================================
// SECURITY FUNCTIONS
// ============================================================================

/**
 * Parse verdict semantically, checking for negation near approval keywords.
 * "NOT approve", "don't approve", "cannot approve" should NOT match as approval.
 *
 * @param text - The response text to analyze
 * @returns true if genuinely approved, false otherwise
 */
export function parseVerdictSemantically(text: string): boolean {
  const lowerText = text.toLowerCase();

  for (const keyword of APPROVAL_KEYWORDS) {
    let pos = 0;
    while ((pos = lowerText.indexOf(keyword, pos)) !== -1) {
      // Check for negation within 15 characters before the keyword
      const startCheck = Math.max(0, pos - 15);
      const precedingText = lowerText.slice(startCheck, pos);

      let isNegated = false;
      for (const negation of NEGATION_PATTERNS) {
        if (precedingText.includes(negation)) {
          isNegated = true;
          break;
        }
      }

      if (!isNegated) {
        // Found a non-negated approval keyword
        return true;
      }

      pos += keyword.length;
    }
  }

  return false;
}

/**
 * Detect potential prompt injection attempts in the task description.
 *
 * @param task - The task string to analyze
 * @returns Object with detected flag and matched patterns
 */
export function detectPromptInjection(task: string): {
  detected: boolean;
  patterns: string[];
  sanitized: string;
} {
  const matchedPatterns: string[] = [];
  let sanitized = task;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(task)) {
      const match = task.match(pattern);
      if (match) {
        matchedPatterns.push(match[0]);
        // Sanitize by replacing with [REDACTED]
        sanitized = sanitized.replace(pattern, "[REDACTED]");
      }
    }
  }

  return {
    detected: matchedPatterns.length > 0,
    patterns: matchedPatterns,
    sanitized,
  };
}

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

  /**
   * Current deliberation depth (internal tracking for recursion limit).
   * Do not set manually - managed by the deliberate function.
   */
  _depth?: number;

  /** Skip prompt injection detection (use with caution) */
  skipInjectionDetection?: boolean;
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
 * Analyze responses to identify conflicts between agents.
 * Uses semantic verdict parsing to detect negated approvals.
 */
function analyzeConflicts(results: AgentDeliberationResult[]): ConflictSummary[] {
  const conflicts: ConflictSummary[] = [];

  // Look for explicit rejection markers in critic responses
  const criticResult = results.find((r) => r.role === "critic");
  if (criticResult?.response) {
    const response = criticResult.response.toLowerCase();

    // Use semantic parsing to check for genuine approval
    const isSemanticApproval = parseVerdictSemantically(criticResult.response);
    const hasPositiveIndicators =
      response.includes("no significant issues") ||
      response.includes("looks good") ||
      response.includes("no issues found");

    const isApproval = isSemanticApproval || hasPositiveIndicators;

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
 * Determine the majority vote based on agent responses.
 * Uses semantic verdict parsing to detect negated approvals.
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
      // Use semantic parsing to detect negated approvals
      const isSemanticApproval = parseVerdictSemantically(result.response);
      const hasPositiveIndicators =
        response.includes("no significant issues") || response.includes("looks good");

      if (isSemanticApproval || hasPositiveIndicators) {
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
 * Error thrown when deliberation depth limit is exceeded
 */
export class DeliberationDepthError extends Error {
  constructor(depth: number) {
    super(
      `Deliberation depth limit exceeded: ${depth} > ${MAX_DELIBERATION_DEPTH}. ` +
        `This may indicate recursive deliberation or an attack.`,
    );
    this.name = "DeliberationDepthError";
  }
}

/**
 * Error thrown when prompt injection is detected
 */
export class PromptInjectionError extends Error {
  constructor(patterns: string[]) {
    super(
      `Potential prompt injection detected. Matched patterns: ${patterns.join(", ")}. ` +
        `Task rejected for security.`,
    );
    this.name = "PromptInjectionError";
  }
}

/**
 * Main deliberation function - spawns multiple agents and synthesizes consensus
 *
 * @param task - The task/decision to deliberate on
 * @param requesterSessionKey - Session key of the requesting agent
 * @param options - Deliberation options
 * @returns Synthesized deliberation outcome
 *
 * @throws {DeliberationDepthError} If recursion depth exceeds MAX_DELIBERATION_DEPTH
 * @throws {PromptInjectionError} If prompt injection is detected and not skipped
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
  const currentDepth = (options._depth ?? 0) + 1;

  // =========================================================================
  // HARDENING: Recursion Depth Limit
  // =========================================================================
  if (currentDepth > MAX_DELIBERATION_DEPTH) {
    throw new DeliberationDepthError(currentDepth);
  }

  // =========================================================================
  // HARDENING: Prompt Injection Detection
  // =========================================================================
  if (!options.skipInjectionDetection) {
    const injectionCheck = detectPromptInjection(task);
    if (injectionCheck.detected) {
      throw new PromptInjectionError(injectionCheck.patterns);
    }
  }

  // =========================================================================
  // HARDENING: Deliberation Semaphore
  // =========================================================================
  await deliberationSemaphore.acquire();

  try {
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
  } finally {
    // =========================================================================
    // HARDENING: Always release semaphore slot
    // =========================================================================
    deliberationSemaphore.release();
  }
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
