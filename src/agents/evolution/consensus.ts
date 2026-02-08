/**
 * Consensus Module for Multi-Agent Deliberation
 *
 * Implements consensus requirements for irreversible/destructive operations.
 * Uses critic agents to validate proposed actions before execution.
 *
 * Pattern: 2/3 majority approval for high-risk operations
 */

import { log } from "../pi-embedded-runner/logger.js";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ConsensusRequest {
  id: string;
  operation: string;
  description: string;
  riskLevel: RiskLevel;
  context: Record<string, unknown>;
  requestedBy: string;
  timestamp: string;
}

export interface CriticVote {
  criticId: string;
  vote: "approve" | "concerns" | "reject";
  reasoning: string;
  concerns?: string[];
  suggestions?: string[];
  timestamp: string;
}

export interface ConsensusResult {
  requestId: string;
  approved: boolean;
  votes: CriticVote[];
  approvalRatio: number;
  requiredRatio: number;
  summary: string;
}

/**
 * Risk thresholds for different operation types
 */
export const OPERATION_RISK_LEVELS: Record<string, RiskLevel> = {
  // Critical - requires 3/3 approval
  delete_file: "high",
  drop_database: "critical",
  deploy_production: "critical",
  modify_auth: "critical",
  delete_session: "medium",

  // High - requires 2/3 approval
  modify_config: "high",
  restart_gateway: "high",
  apply_patch: "high",
  git_push: "high",

  // Medium - requires 1/2 approval
  create_file: "medium",
  modify_file: "medium",
  run_tests: "low",

  // Low - no consensus needed
  read_file: "low",
  search: "low",
  query: "low",
};

/**
 * Required approval ratios by risk level
 */
const APPROVAL_THRESHOLDS: Record<RiskLevel, number> = {
  low: 0, // No consensus needed
  medium: 0.5, // 1/2 approval
  high: 0.67, // 2/3 approval
  critical: 1.0, // Unanimous approval
};

/**
 * Number of critics to consult by risk level
 */
const CRITIC_COUNT: Record<RiskLevel, number> = {
  low: 0,
  medium: 2,
  high: 3,
  critical: 3,
};

export class ConsensusManager {
  private pendingRequests: Map<string, ConsensusRequest> = new Map();
  private votes: Map<string, CriticVote[]> = new Map();

  /**
   * Determine if an operation requires consensus
   */
  requiresConsensus(operation: string): boolean {
    const riskLevel = this.getRiskLevel(operation);
    return riskLevel !== "low";
  }

  /**
   * Get risk level for an operation
   */
  getRiskLevel(operation: string): RiskLevel {
    // Direct match
    if (OPERATION_RISK_LEVELS[operation]) {
      return OPERATION_RISK_LEVELS[operation];
    }

    // Pattern matching for common operations
    const lowerOp = operation.toLowerCase();

    if (lowerOp.includes("delete") || lowerOp.includes("remove") || lowerOp.includes("drop")) {
      return "high";
    }
    if (lowerOp.includes("deploy") || lowerOp.includes("production")) {
      return "critical";
    }
    if (lowerOp.includes("modify") || lowerOp.includes("update") || lowerOp.includes("patch")) {
      return "medium";
    }
    if (lowerOp.includes("create") || lowerOp.includes("add") || lowerOp.includes("write")) {
      return "medium";
    }

    return "low";
  }

  /**
   * Create a consensus request
   */
  createRequest(
    operation: string,
    description: string,
    context: Record<string, unknown>,
    requestedBy: string,
  ): ConsensusRequest {
    const request: ConsensusRequest = {
      id: crypto.randomUUID(),
      operation,
      description,
      riskLevel: this.getRiskLevel(operation),
      context,
      requestedBy,
      timestamp: new Date().toISOString(),
    };

    this.pendingRequests.set(request.id, request);
    this.votes.set(request.id, []);

    log.info(
      `[consensus] Created request ${request.id} for ${operation} (${request.riskLevel} risk)`,
    );

    return request;
  }

  /**
   * Generate prompt for critic evaluation
   */
  generateCriticPrompt(request: ConsensusRequest): string {
    return `# Consensus Review Required

## Operation
**Type:** ${request.operation}
**Risk Level:** ${request.riskLevel.toUpperCase()}
**Requested by:** ${request.requestedBy}

## Description
${request.description}

## Context
\`\`\`json
${JSON.stringify(request.context, null, 2)}
\`\`\`

## Your Task
As a critical evaluator, assess this operation:

1. **Is this operation safe to proceed?**
2. **What are the potential risks?**
3. **Are there edge cases or failure modes?**
4. **Is there a safer alternative?**

## Response Format
Respond with your vote and reasoning:
- **APPROVE** - Safe to proceed
- **CONCERNS** - Proceed with caution, address issues first
- **REJECT** - Do not proceed, too risky

Include specific concerns and suggestions.`;
  }

  /**
   * Record a critic's vote
   */
  recordVote(requestId: string, vote: CriticVote): void {
    const votes = this.votes.get(requestId) || [];
    votes.push(vote);
    this.votes.set(requestId, votes);

    log.info(`[consensus] Vote recorded for ${requestId}: ${vote.vote} by ${vote.criticId}`);
  }

  /**
   * Parse critic response into a vote
   */
  parseVoteFromResponse(criticId: string, response: string): CriticVote {
    const lowerResponse = response.toLowerCase();

    let vote: CriticVote["vote"] = "concerns";
    if (lowerResponse.includes("**approve**") || lowerResponse.startsWith("approve")) {
      vote = "approve";
    } else if (lowerResponse.includes("**reject**") || lowerResponse.startsWith("reject")) {
      vote = "reject";
    }

    // Extract concerns (lines starting with - or *)
    const concerns = response
      .split("\n")
      .filter((line) => /^[\-\*]\s/.test(line.trim()))
      .map((line) => line.trim().replace(/^[\-\*]\s*/, ""));

    return {
      criticId,
      vote,
      reasoning: response.slice(0, 500),
      concerns: concerns.length > 0 ? concerns : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check if consensus is reached
   */
  checkConsensus(requestId: string): ConsensusResult | null {
    const request = this.pendingRequests.get(requestId);
    const votes = this.votes.get(requestId);

    if (!request || !votes) {
      return null;
    }

    const requiredCritics = CRITIC_COUNT[request.riskLevel];
    if (votes.length < requiredCritics) {
      return null; // Not enough votes yet
    }

    const requiredRatio = APPROVAL_THRESHOLDS[request.riskLevel];
    const approveCount = votes.filter((v) => v.vote === "approve").length;
    const rejectCount = votes.filter((v) => v.vote === "reject").length;
    const approvalRatio = approveCount / votes.length;

    // Any reject in critical operations = rejection
    const approved =
      request.riskLevel === "critical"
        ? rejectCount === 0 && approvalRatio >= requiredRatio
        : approvalRatio >= requiredRatio;

    const result: ConsensusResult = {
      requestId,
      approved,
      votes,
      approvalRatio,
      requiredRatio,
      summary: this.generateSummary(request, votes, approved),
    };

    // Clean up
    this.pendingRequests.delete(requestId);
    this.votes.delete(requestId);

    log.info(
      `[consensus] Result for ${requestId}: ${approved ? "APPROVED" : "REJECTED"} (${(approvalRatio * 100).toFixed(0)}% approval)`,
    );

    return result;
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    request: ConsensusRequest,
    votes: CriticVote[],
    approved: boolean,
  ): string {
    const voteBreakdown = votes.map((v) => `- ${v.criticId}: ${v.vote.toUpperCase()}`).join("\n");

    const allConcerns = votes
      .flatMap((v) => v.concerns || [])
      .filter((c, i, arr) => arr.indexOf(c) === i); // dedupe

    return `## Consensus ${approved ? "✅ APPROVED" : "❌ REJECTED"}

**Operation:** ${request.operation}
**Risk Level:** ${request.riskLevel}

### Votes
${voteBreakdown}

${allConcerns.length > 0 ? `### Concerns Raised\n${allConcerns.map((c) => `- ${c}`).join("\n")}` : ""}
`;
  }

  /**
   * Get number of critics needed for an operation
   */
  getCriticCount(operation: string): number {
    const riskLevel = this.getRiskLevel(operation);
    return CRITIC_COUNT[riskLevel];
  }

  /**
   * Quick check if operation can proceed without consensus
   */
  canProceedWithoutConsensus(operation: string): boolean {
    return this.getRiskLevel(operation) === "low";
  }
}

// Singleton instance
let consensusInstance: ConsensusManager | null = null;

export function getConsensusManager(): ConsensusManager {
  if (!consensusInstance) {
    consensusInstance = new ConsensusManager();
  }
  return consensusInstance;
}

/**
 * Helper to run consensus check for an operation
 */
export async function requireConsensus(
  operation: string,
  description: string,
  context: Record<string, unknown>,
  requestedBy: string,
  getCriticResponse: (prompt: string, criticId: string) => Promise<string>,
): Promise<ConsensusResult> {
  const manager = getConsensusManager();

  if (manager.canProceedWithoutConsensus(operation)) {
    return {
      requestId: "auto-approved",
      approved: true,
      votes: [],
      approvalRatio: 1,
      requiredRatio: 0,
      summary: `Operation "${operation}" is low-risk, auto-approved.`,
    };
  }

  const request = manager.createRequest(operation, description, context, requestedBy);
  const criticCount = manager.getCriticCount(operation);

  // Get votes from critics
  for (let i = 0; i < criticCount; i++) {
    const criticId = `critic-${i + 1}`;
    const prompt = manager.generateCriticPrompt(request);

    try {
      const response = await getCriticResponse(prompt, criticId);
      const vote = manager.parseVoteFromResponse(criticId, response);
      manager.recordVote(request.id, vote);
    } catch (error) {
      // Treat errors as rejection for safety
      manager.recordVote(request.id, {
        criticId,
        vote: "reject",
        reasoning: `Error getting critic response: ${error}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  const result = manager.checkConsensus(request.id);
  if (!result) {
    throw new Error("Failed to reach consensus");
  }

  return result;
}
