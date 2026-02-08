/**
 * Session Orchestrator - HARDENED Multi-Agent Deliberation System
 *
 * Hardening measures for stress-tested vulnerabilities:
 * - Timeout-tolerant consensus
 * - Semantic verdict parsing (not substring)
 * - Prompt injection defenses
 * - Crash recovery with cleanup
 * - Recursion depth limits
 * - Concurrency controls
 */

import crypto from "node:crypto";
import type { AgentRole } from "./tools/sessions-spawn-tool.js";
import { callGateway } from "../gateway/call.js";

// ============================================================================
// HARDENING: Concurrency Controls
// ============================================================================

/** Global semaphore for deliberation concurrency */
const DELIBERATION_SEMAPHORE = {
  maxConcurrent: 5,
  current: 0,
  queue: [] as Array<() => void>,
};

async function acquireDeliberationSlot(): Promise<() => void> {
  if (DELIBERATION_SEMAPHORE.current < DELIBERATION_SEMAPHORE.maxConcurrent) {
    DELIBERATION_SEMAPHORE.current++;
    return () => {
      DELIBERATION_SEMAPHORE.current--;
      const next = DELIBERATION_SEMAPHORE.queue.shift();
      if (next) next();
    };
  }

  // Wait in queue
  return new Promise((resolve) => {
    DELIBERATION_SEMAPHORE.queue.push(() => {
      DELIBERATION_SEMAPHORE.current++;
      resolve(() => {
        DELIBERATION_SEMAPHORE.current--;
        const next = DELIBERATION_SEMAPHORE.queue.shift();
        if (next) next();
      });
    });
  });
}

// ============================================================================
// HARDENING: Recursion Depth Tracking
// ============================================================================

const DELIBERATION_DEPTH_HEADER = "X-Deliberation-Depth";
const MAX_DELIBERATION_DEPTH = 3;

interface DeliberationContext {
  depth: number;
  parentId?: string;
  startedAt: number;
}

const activeDeliberations = new Map<string, DeliberationContext>();

// ============================================================================
// HARDENING: Prompt Injection Detection
// ============================================================================

const INJECTION_PATTERNS = [
  /system\s*(override|prompt|instruction)/i,
  /ignore\s*(previous|above|all)/i,
  /you\s*are\s*now/i,
  /disregard\s*(your|the)\s*(instructions|role)/i,
  /always\s*(respond|say|output)\s*(with|that)/i,
  /pretend\s*(you|to\s*be)/i,
  /roleplay\s*as/i,
  /\[\s*system\s*\]/i,
  /```\s*(system|prompt)/i,
];

function detectPromptInjection(task: string): { detected: boolean; patterns: string[] } {
  const detected: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(task)) {
      detected.push(pattern.source);
    }
  }
  return { detected: detected.length > 0, patterns: detected };
}

function sanitizeTask(task: string): string {
  // Limit length
  const MAX_TASK_LENGTH = 10_000;
  if (task.length > MAX_TASK_LENGTH) {
    task = task.slice(0, MAX_TASK_LENGTH) + "\n[TRUNCATED]";
  }

  // Escape potential prompt injection markers
  task = task.replace(/\[system\]/gi, "[FILTERED]").replace(/```system/gi, "```filtered");

  return task;
}

// ============================================================================
// HARDENING: Semantic Verdict Parsing
// ============================================================================

interface ParsedVerdict {
  decision: "approve" | "reject" | "unclear";
  confidence: number;
  concerns: string[];
  reasoning: string;
}

/**
 * Parse verdict using structured patterns, not substring matching
 */
function parseVerdictSemantically(response: string, role: AgentRole): ParsedVerdict {
  const lines = response.split("\n").map((l) => l.trim().toLowerCase());

  // Look for explicit verdict markers (should be at start of response)
  const verdictLine = lines.find(
    (l) => l.startsWith("verdict:") || l.startsWith("decision:") || l.startsWith("recommendation:"),
  );

  let decision: "approve" | "reject" | "unclear" = "unclear";
  let confidence = 0.5;

  if (verdictLine) {
    // Structured verdict found - trust it more
    if (/approve|proceed|accept|lgtm/i.test(verdictLine)) {
      // But check for negation IN THE SAME LINE
      if (/\b(not?|don'?t|cannot|shouldn'?t|never)\b/i.test(verdictLine)) {
        decision = "reject";
        confidence = 0.8;
      } else {
        decision = "approve";
        confidence = 0.9;
      }
    } else if (/reject|deny|block|stop|critical/i.test(verdictLine)) {
      decision = "reject";
      confidence = 0.9;
    }
  } else {
    // Fallback: count weighted signals
    let approveSignals = 0;
    let rejectSignals = 0;

    const fullText = response.toLowerCase();

    // Positive signals (with negation check)
    const positivePatterns = [
      { pattern: /\bapprove\b/, weight: 2 },
      { pattern: /\blooks?\s+good\b/, weight: 1 },
      { pattern: /\bno\s+(significant|major|critical)\s+issues?\b/, weight: 2 },
      { pattern: /\brecommend\s+(proceeding|approval)\b/, weight: 2 },
    ];

    // Negative signals
    const negativePatterns = [
      { pattern: /\breject\b/, weight: 2 },
      { pattern: /\bcritical\s+(issue|flaw|vulnerability)\b/, weight: 3 },
      { pattern: /\bdo\s+not\s+proceed\b/, weight: 3 },
      { pattern: /\bsecurity\s+(concern|vulnerability|risk)\b/, weight: 2 },
      { pattern: /\bblocking\s+issue\b/, weight: 3 },
    ];

    for (const { pattern, weight } of positivePatterns) {
      if (pattern.test(fullText)) {
        // Check for negation within 10 chars before the match
        const match = fullText.match(pattern);
        if (match && match.index !== undefined) {
          const prefix = fullText.slice(Math.max(0, match.index - 15), match.index);
          if (/\b(not?|don'?t|never|cannot)\b/.test(prefix)) {
            rejectSignals += weight;
          } else {
            approveSignals += weight;
          }
        }
      }
    }

    for (const { pattern, weight } of negativePatterns) {
      if (pattern.test(fullText)) rejectSignals += weight;
    }

    if (approveSignals > rejectSignals + 1) {
      decision = "approve";
      confidence = Math.min(0.8, 0.5 + (approveSignals - rejectSignals) * 0.1);
    } else if (rejectSignals > approveSignals + 1) {
      decision = "reject";
      confidence = Math.min(0.8, 0.5 + (rejectSignals - approveSignals) * 0.1);
    }
  }

  // Extract concerns
  const concerns = extractConcernsEnhanced(response);

  return {
    decision,
    confidence,
    concerns,
    reasoning: verdictLine ?? lines.slice(0, 3).join(" "),
  };
}

function extractConcernsEnhanced(response: string): string[] {
  const concerns: string[] = [];
  const lines = response.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Look for concern indicators
    if (
      /^[-*•]\s*(concern|issue|problem|warning|risk|vulnerability)/i.test(line) ||
      /^(\d+\.)\s*(concern|issue|problem|warning|risk)/i.test(line)
    ) {
      const content = line.replace(/^[-*•\d.]+\s*/, "");
      if (content.length > 10 && content.length < 300) {
        concerns.push(content);
      }
    }
  }

  return concerns.slice(0, 10);
}

// ============================================================================
// HARDENING: Crash Recovery Registry
// ============================================================================

interface ActiveDeliberation {
  id: string;
  requesterSessionKey: string;
  spawnedSessions: string[];
  startedAt: number;
  timeoutAt: number;
}

const deliberationRegistry = new Map<string, ActiveDeliberation>();

function registerDeliberation(id: string, requesterSessionKey: string, timeoutMs: number): void {
  deliberationRegistry.set(id, {
    id,
    requesterSessionKey,
    spawnedSessions: [],
    startedAt: Date.now(),
    timeoutAt: Date.now() + timeoutMs,
  });
}

function addSpawnedSession(deliberationId: string, sessionKey: string): void {
  const entry = deliberationRegistry.get(deliberationId);
  if (entry) {
    entry.spawnedSessions.push(sessionKey);
  }
}

function unregisterDeliberation(id: string): void {
  deliberationRegistry.delete(id);
}

async function cleanupOrphanedDeliberations(): Promise<number> {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, entry] of deliberationRegistry) {
    if (now > entry.timeoutAt + 60_000) {
      // 1 min grace period
      // Cancel all spawned sessions
      for (const sessionKey of entry.spawnedSessions) {
        try {
          await callGateway({
            method: "sessions.cancel",
            params: { key: sessionKey },
            timeoutMs: 5000,
          });
        } catch {
          // Best effort cleanup
        }
      }
      deliberationRegistry.delete(id);
      cleaned++;
    }
  }

  return cleaned;
}

// Run cleanup every 5 minutes
setInterval(
  () => {
    cleanupOrphanedDeliberations().catch(() => {});
  },
  5 * 60 * 1000,
);

// ============================================================================
// HARDENING: Timeout-Tolerant Consensus
// ============================================================================

interface TimeoutTolerantVote {
  role: AgentRole;
  vote: "proceed" | "reject" | "abstain";
  weight: number;
  confidence: number;
  timedOut: boolean;
}

function computeTimeoutTolerantConsensus(results: AgentDeliberationResult[]): {
  decision: "proceed" | "reject" | "needs_review";
  confidence: number;
  voteSummary: TimeoutTolerantVote[];
} {
  const votes: TimeoutTolerantVote[] = [];

  for (const result of results) {
    if (result.status === "timeout") {
      // Timeout = abstain with reduced weight, not automatic reject
      votes.push({
        role: result.role,
        vote: "abstain",
        weight: 0.3, // Partial response might still be useful
        confidence: 0.3,
        timedOut: true,
      });
      continue;
    }

    if (result.status === "error") {
      // Errors are more serious - count as soft reject
      votes.push({
        role: result.role,
        vote: "reject",
        weight: 0.5,
        confidence: 0.5,
        timedOut: false,
      });
      continue;
    }

    // Parse actual verdict
    const verdict = parseVerdictSemantically(result.response, result.role);

    let vote: "proceed" | "reject" | "abstain";
    if (verdict.decision === "approve") vote = "proceed";
    else if (verdict.decision === "reject") vote = "reject";
    else vote = "abstain";

    // Role-based weights
    const roleWeights: Record<AgentRole, number> = {
      executor: 1.0,
      critic: 1.5, // Critics have more weight on security decisions
      reviewer: 1.0,
      planner: 0.8,
      debugger: 0.8,
      refactorer: 0.7,
      documenter: 0.5,
      tester: 1.2,
    };

    votes.push({
      role: result.role,
      vote,
      weight: roleWeights[result.role] ?? 1.0,
      confidence: verdict.confidence,
      timedOut: false,
    });
  }

  // Weighted voting
  let proceedScore = 0;
  let rejectScore = 0;
  let totalWeight = 0;

  for (const v of votes) {
    const effectiveWeight = v.weight * v.confidence;
    totalWeight += effectiveWeight;

    if (v.vote === "proceed") proceedScore += effectiveWeight;
    else if (v.vote === "reject") rejectScore += effectiveWeight;
    // abstain doesn't add to either
  }

  // Critical rule: ANY critic reject with high confidence blocks
  const criticReject = votes.find(
    (v) => v.role === "critic" && v.vote === "reject" && v.confidence >= 0.8,
  );
  if (criticReject) {
    return {
      decision: "reject",
      confidence: criticReject.confidence,
      voteSummary: votes,
    };
  }

  // Compute normalized scores
  const proceedRatio = totalWeight > 0 ? proceedScore / totalWeight : 0;
  const rejectRatio = totalWeight > 0 ? rejectScore / totalWeight : 0;

  if (proceedRatio >= 0.6) {
    return { decision: "proceed", confidence: proceedRatio, voteSummary: votes };
  } else if (rejectRatio >= 0.4) {
    return { decision: "reject", confidence: rejectRatio, voteSummary: votes };
  } else {
    return {
      decision: "needs_review",
      confidence: Math.max(proceedRatio, rejectRatio),
      voteSummary: votes,
    };
  }
}

// ============================================================================
// MAIN HARDENED DELIBERATE FUNCTION
// ============================================================================

export interface HardenedDeliberateOptions {
  roles?: AgentRole[];
  requiresConsensus?: boolean;
  agentTimeoutSeconds?: number;
  agentId?: string;
  model?: string;
  /** Existing deliberation depth (for recursion tracking) */
  currentDepth?: number;
  /** Skip prompt injection check (only for trusted internal calls) */
  trustedTask?: boolean;
  onConflict?: (outcome: DeliberationOutcome) => Promise<"proceed" | "abort">;
}

// Re-export existing types
export type { AgentDeliberationResult, DeliberationOutcome, ConflictSummary, DissentingOpinion };

export async function deliberateHardened(
  task: string,
  requesterSessionKey: string,
  options: HardenedDeliberateOptions = {},
): Promise<DeliberationOutcome> {
  const deliberationId = crypto.randomUUID();
  const startTime = Date.now();
  const depth = options.currentDepth ?? 0;

  // ========== GUARD: Recursion Depth ==========
  if (depth >= MAX_DELIBERATION_DEPTH) {
    return {
      consensusReached: false,
      agentResults: [],
      conflicts: [
        {
          topic: "Recursion limit",
          disagreingRoles: [],
          description: `Maximum deliberation depth (${MAX_DELIBERATION_DEPTH}) exceeded`,
          severity: "critical",
        },
      ],
      majorityVote: "reject",
      dissentingOpinions: [],
      totalDurationMs: 0,
    };
  }

  // ========== GUARD: Prompt Injection ==========
  if (!options.trustedTask) {
    const injection = detectPromptInjection(task);
    if (injection.detected) {
      console.warn(`[deliberate] Prompt injection detected: ${injection.patterns.join(", ")}`);
      return {
        consensusReached: false,
        agentResults: [],
        conflicts: [
          {
            topic: "Security",
            disagreingRoles: [],
            description: "Potential prompt injection detected in task",
            severity: "critical",
          },
        ],
        majorityVote: "reject",
        dissentingOpinions: [],
        totalDurationMs: 0,
      };
    }
    task = sanitizeTask(task);
  }

  // ========== GUARD: Concurrency Limit ==========
  const releaseSlot = await acquireDeliberationSlot();

  try {
    const roles = options.roles ?? ["executor", "critic"];
    const timeoutMs = (options.agentTimeoutSeconds ?? 300) * 1000;

    // Register for crash recovery
    registerDeliberation(deliberationId, requesterSessionKey, timeoutMs);

    // Spawn agents with depth tracking
    const spawnPromises = roles.map(async (role) => {
      const childSessionKey = `agent:deliberation:${role}:${crypto.randomUUID()}`;

      // Track spawned session for cleanup
      addSpawnedSession(deliberationId, childSessionKey);

      const response = await callGateway<{ runId: string }>({
        method: "agent",
        params: {
          message: task,
          sessionKey: childSessionKey,
          idempotencyKey: crypto.randomUUID(),
          deliver: false,
          lane: "subagent",
          role,
          timeout: options.agentTimeoutSeconds ?? 300,
          label: `Deliberation (${role}) [depth=${depth}]`,
          spawnedBy: requesterSessionKey,
          // Pass depth to child agents
          metadata: {
            deliberationDepth: depth + 1,
            parentDeliberationId: deliberationId,
          },
        },
        timeoutMs: 10_000,
      });

      return {
        runId: response?.runId ?? crypto.randomUUID(),
        sessionKey: childSessionKey,
        role,
      };
    });

    const spawns = await Promise.all(spawnPromises);

    // Wait for results with individual timeouts
    const resultPromises = spawns.map((spawn) =>
      waitForAgentResultHardened(spawn.runId, spawn.sessionKey, spawn.role, timeoutMs),
    );

    const results = await Promise.all(resultPromises);

    // Use timeout-tolerant consensus
    const consensus = computeTimeoutTolerantConsensus(results);

    // Analyze conflicts with enhanced detection
    const conflicts = analyzeConflictsEnhanced(results);

    const decision = results.find((r) => r.role === "executor" && r.status === "ok")?.response;

    const consensusReached =
      consensus.decision === "proceed" &&
      consensus.confidence >= 0.7 &&
      !conflicts.some((c) => c.severity === "critical");

    const outcome: DeliberationOutcome = {
      consensusReached,
      decision: consensusReached ? decision : undefined,
      agentResults: results,
      conflicts,
      majorityVote: consensus.decision,
      dissentingOpinions: extractDissentingOpinionsEnhanced(results, consensus.decision),
      totalDurationMs: Date.now() - startTime,
    };

    // Conflict handler
    if (options.requiresConsensus && !consensusReached && options.onConflict) {
      const resolution = await options.onConflict(outcome);
      if (resolution === "proceed") {
        outcome.consensusReached = true;
        outcome.decision = decision;
      }
    }

    return outcome;
  } finally {
    // Always cleanup
    unregisterDeliberation(deliberationId);
    releaseSlot();
  }
}

// Hardened wait function with better timeout handling
async function waitForAgentResultHardened(
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
      params: { runId, timeoutMs },
      timeoutMs: timeoutMs + 5000,
    });

    const reply = await callGateway<{ content?: string }>({
      method: "sessions.getLatestReply",
      params: { key: sessionKey },
      timeoutMs: 5000,
    });

    const durationMs = Date.now() - startTime;

    // Differentiate timeout with partial response vs complete timeout
    if (wait?.status === "timeout") {
      const hasPartialResponse = reply?.content && reply.content.length > 50;
      return {
        role,
        runId,
        sessionKey,
        response: reply?.content ?? "",
        status: hasPartialResponse ? "ok" : "timeout", // Partial = ok with reduced confidence
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

function analyzeConflictsEnhanced(results: AgentDeliberationResult[]): ConflictSummary[] {
  const conflicts: ConflictSummary[] = [];

  for (const result of results) {
    if (result.role !== "critic" || result.status !== "ok") continue;

    const verdict = parseVerdictSemantically(result.response, result.role);

    if (verdict.decision === "reject") {
      conflicts.push({
        topic: "Critic rejection",
        disagreingRoles: ["executor", "critic"],
        description: verdict.reasoning,
        severity: verdict.confidence >= 0.8 ? "critical" : "moderate",
      });
    }

    // Add individual concerns as minor conflicts
    for (const concern of verdict.concerns.slice(0, 3)) {
      conflicts.push({
        topic: "Concern",
        disagreingRoles: ["critic"],
        description: concern,
        severity: "minor",
      });
    }
  }

  return conflicts;
}

function extractDissentingOpinionsEnhanced(
  results: AgentDeliberationResult[],
  majorityVote: "proceed" | "reject" | "needs_review",
): DissentingOpinion[] {
  const dissenting: DissentingOpinion[] = [];

  for (const result of results) {
    if (result.status !== "ok") continue;

    const verdict = parseVerdictSemantically(result.response, result.role);

    // Check if this agent disagreed with majority
    const agreesWith =
      (verdict.decision === "approve" && majorityVote === "proceed") ||
      (verdict.decision === "reject" && majorityVote === "reject");

    if (!agreesWith && verdict.decision !== "unclear") {
      dissenting.push({
        role: result.role,
        opinion: `Voted ${verdict.decision} against majority ${majorityVote}`,
        reasons: verdict.concerns,
      });
    }
  }

  return dissenting;
}

// ============================================================================
// EXPORTS
// ============================================================================

export { cleanupOrphanedDeliberations, detectPromptInjection };
export const getDeliberationStats = () => ({
  active: deliberationRegistry.size,
  queuedSlots: DELIBERATION_SEMAPHORE.queue.length,
  currentConcurrency: DELIBERATION_SEMAPHORE.current,
  maxConcurrency: DELIBERATION_SEMAPHORE.maxConcurrent,
});
