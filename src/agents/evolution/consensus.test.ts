/**
 * Tests for Consensus Module
 *
 * Validates multi-agent deliberation and approval mechanisms
 * for high-risk operations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ConsensusManager,
  OPERATION_RISK_LEVELS,
  requireConsensus,
  type CriticVote,
} from "./consensus.js";

describe("ConsensusManager", () => {
  let manager: ConsensusManager;

  beforeEach(() => {
    manager = new ConsensusManager();
  });

  describe("getRiskLevel", () => {
    it("should return correct risk for known operations", () => {
      expect(manager.getRiskLevel("delete_file")).toBe("high");
      expect(manager.getRiskLevel("deploy_production")).toBe("critical");
      expect(manager.getRiskLevel("read_file")).toBe("low");
      expect(manager.getRiskLevel("modify_config")).toBe("high");
    });

    it("should infer risk from operation patterns", () => {
      expect(manager.getRiskLevel("delete_user_data")).toBe("high");
      expect(manager.getRiskLevel("deploy_to_staging")).toBe("critical");
      expect(manager.getRiskLevel("create_backup")).toBe("medium");
      expect(manager.getRiskLevel("update_settings")).toBe("medium");
    });

    it("should default to low for unknown operations", () => {
      expect(manager.getRiskLevel("some_random_operation")).toBe("low");
    });
  });

  describe("requiresConsensus", () => {
    it("should require consensus for high-risk operations", () => {
      expect(manager.requiresConsensus("delete_file")).toBe(true);
      expect(manager.requiresConsensus("deploy_production")).toBe(true);
      expect(manager.requiresConsensus("modify_config")).toBe(true);
    });

    it("should not require consensus for low-risk operations", () => {
      expect(manager.requiresConsensus("read_file")).toBe(false);
      expect(manager.requiresConsensus("search")).toBe(false);
      expect(manager.requiresConsensus("query")).toBe(false);
    });
  });

  describe("getCriticCount", () => {
    it("should return correct critic count by risk level", () => {
      expect(manager.getCriticCount("read_file")).toBe(0);
      expect(manager.getCriticCount("create_file")).toBe(2);
      expect(manager.getCriticCount("delete_file")).toBe(3);
      expect(manager.getCriticCount("deploy_production")).toBe(3);
    });
  });

  describe("createRequest", () => {
    it("should create a request with correct properties", () => {
      const request = manager.createRequest(
        "delete_file",
        "Delete user data file",
        { path: "/data/users.json" },
        "agent-1",
      );

      expect(request.id).toBeDefined();
      expect(request.operation).toBe("delete_file");
      expect(request.description).toBe("Delete user data file");
      expect(request.riskLevel).toBe("high");
      expect(request.context).toEqual({ path: "/data/users.json" });
      expect(request.requestedBy).toBe("agent-1");
      expect(request.timestamp).toBeDefined();
    });
  });

  describe("generateCriticPrompt", () => {
    it("should generate a detailed prompt for critics", () => {
      const request = manager.createRequest(
        "deploy_production",
        "Deploy new version to production",
        { version: "2.0.0" },
        "agent-1",
      );

      const prompt = manager.generateCriticPrompt(request);

      expect(prompt).toContain("deploy_production");
      expect(prompt).toContain("CRITICAL");
      expect(prompt).toContain("2.0.0");
      expect(prompt).toContain("APPROVE");
      expect(prompt).toContain("REJECT");
    });
  });

  describe("parseVoteFromResponse", () => {
    it("should parse APPROVE vote", () => {
      const response = "**APPROVE** - This looks safe to proceed.";
      const vote = manager.parseVoteFromResponse("critic-1", response);

      expect(vote.vote).toBe("approve");
      expect(vote.criticId).toBe("critic-1");
    });

    it("should parse REJECT vote", () => {
      const response = "**REJECT** - Too risky, could cause data loss.";
      const vote = manager.parseVoteFromResponse("critic-1", response);

      expect(vote.vote).toBe("reject");
    });

    it("should default to concerns for ambiguous responses", () => {
      const response = "I have some issues with this approach.";
      const vote = manager.parseVoteFromResponse("critic-1", response);

      expect(vote.vote).toBe("concerns");
    });

    it("should extract concerns from bullet points", () => {
      const response = `**CONCERNS**
- Could cause data corruption
- No rollback plan
* Missing error handling`;

      const vote = manager.parseVoteFromResponse("critic-1", response);

      expect(vote.concerns).toContain("Could cause data corruption");
      expect(vote.concerns).toContain("No rollback plan");
      expect(vote.concerns).toContain("Missing error handling");
    });
  });

  describe("recordVote and checkConsensus", () => {
    it("should approve when majority approves (medium risk)", () => {
      const request = manager.createRequest("create_file", "Create new config file", {}, "agent-1");

      // 2 critics needed for medium risk, 0.5 approval ratio
      manager.recordVote(request.id, createVote("critic-1", "approve"));
      manager.recordVote(request.id, createVote("critic-2", "concerns"));

      const result = manager.checkConsensus(request.id);

      expect(result).not.toBeNull();
      expect(result!.approved).toBe(true);
      expect(result!.approvalRatio).toBe(0.5);
    });

    it("should reject when insufficient approval (high risk)", () => {
      const request = manager.createRequest("delete_file", "Delete important file", {}, "agent-1");

      // 3 critics needed for high risk, 0.67 approval ratio required
      manager.recordVote(request.id, createVote("critic-1", "approve"));
      manager.recordVote(request.id, createVote("critic-2", "reject"));
      manager.recordVote(request.id, createVote("critic-3", "reject"));

      const result = manager.checkConsensus(request.id);

      expect(result).not.toBeNull();
      expect(result!.approved).toBe(false);
      expect(result!.approvalRatio).toBeCloseTo(0.33, 1);
    });

    it("should require unanimous approval for critical operations", () => {
      const request = manager.createRequest(
        "deploy_production",
        "Deploy to production",
        {},
        "agent-1",
      );

      // All 3 approve
      manager.recordVote(request.id, createVote("critic-1", "approve"));
      manager.recordVote(request.id, createVote("critic-2", "approve"));
      manager.recordVote(request.id, createVote("critic-3", "approve"));

      const result = manager.checkConsensus(request.id);

      expect(result).not.toBeNull();
      expect(result!.approved).toBe(true);
    });

    it("should reject critical operation with any rejection", () => {
      const request = manager.createRequest(
        "deploy_production",
        "Deploy to production",
        {},
        "agent-1",
      );

      // 2 approve, 1 reject - should fail for critical
      manager.recordVote(request.id, createVote("critic-1", "approve"));
      manager.recordVote(request.id, createVote("critic-2", "approve"));
      manager.recordVote(request.id, createVote("critic-3", "reject"));

      const result = manager.checkConsensus(request.id);

      expect(result).not.toBeNull();
      expect(result!.approved).toBe(false);
    });

    it("should return null if not enough votes", () => {
      const request = manager.createRequest("delete_file", "Delete file", {}, "agent-1");

      // Only 1 vote, need 3
      manager.recordVote(request.id, createVote("critic-1", "approve"));

      const result = manager.checkConsensus(request.id);

      expect(result).toBeNull();
    });
  });

  describe("canProceedWithoutConsensus", () => {
    it("should allow low-risk operations without consensus", () => {
      expect(manager.canProceedWithoutConsensus("read_file")).toBe(true);
      expect(manager.canProceedWithoutConsensus("search")).toBe(true);
    });

    it("should require consensus for risky operations", () => {
      expect(manager.canProceedWithoutConsensus("delete_file")).toBe(false);
      expect(manager.canProceedWithoutConsensus("deploy_production")).toBe(false);
    });
  });
});

describe("requireConsensus helper", () => {
  it("should auto-approve low-risk operations", async () => {
    const result = await requireConsensus(
      "read_file",
      "Read a config file",
      { path: "/config.json" },
      "agent-1",
      async () => "should not be called",
    );

    expect(result.approved).toBe(true);
    expect(result.votes).toHaveLength(0);
    expect(result.summary).toContain("auto-approved");
  });

  it("should collect votes for risky operations", async () => {
    let callCount = 0;

    const result = await requireConsensus(
      "modify_config",
      "Update gateway config",
      { setting: "timeout" },
      "agent-1",
      async () => {
        callCount++;
        return "**APPROVE** - Looks safe";
      },
    );

    expect(callCount).toBe(3); // High risk = 3 critics
    expect(result.approved).toBe(true);
    expect(result.votes).toHaveLength(3);
  });

  it("should handle critic errors as rejections", async () => {
    const result = await requireConsensus(
      "modify_file",
      "Modify important file",
      {},
      "agent-1",
      async () => {
        throw new Error("Critic unavailable");
      },
    );

    // 2 critics for medium risk, both error = both reject
    expect(result.approved).toBe(false);
    expect(result.votes.every((v) => v.vote === "reject")).toBe(true);
  });
});

// Helper to create vote objects
function createVote(criticId: string, vote: CriticVote["vote"]): CriticVote {
  return {
    criticId,
    vote,
    reasoning: `Test vote: ${vote}`,
    timestamp: new Date().toISOString(),
  };
}
