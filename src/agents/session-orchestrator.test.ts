/**
 * Tests for Multi-Agent Deliberation System
 *
 * Demonstrates the devil's advocate pattern where a critic agent
 * catches potential issues in proposed approaches.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  deliberate,
  quickDebate,
  createDebateGuard,
  type DeliberationOutcome,
  type AgentDeliberationResult,
} from "./session-orchestrator.js";

// Mock the gateway calls
vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(),
}));

import { callGateway } from "../gateway/call.js";

const mockCallGateway = vi.mocked(callGateway);

describe("Session Orchestrator - Multi-Agent Deliberation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("deliberate()", () => {
    it("should spawn executor and critic by default", async () => {
      // Setup mock responses
      let spawnCount = 0;
      mockCallGateway.mockImplementation(async (opts) => {
        if (opts.method === "agent") {
          spawnCount++;
          return { runId: `run-${spawnCount}` };
        }
        if (opts.method === "agent.wait") {
          return { status: "ok" };
        }
        if (opts.method === "sessions.getLatestReply") {
          const key = (opts.params as { key?: string })?.key ?? "";
          if (key.includes("executor")) {
            return { content: "Task completed successfully. Implemented the feature." };
          }
          if (key.includes("critic")) {
            return { content: "Assessment: approve\nNo significant issues found." };
          }
        }
        return {};
      });

      const outcome = await deliberate(
        "Implement a simple hello world function",
        "agent:main:test-session",
      );

      expect(outcome.agentResults).toHaveLength(2);
      expect(outcome.agentResults.map((r) => r.role)).toContain("executor");
      expect(outcome.agentResults.map((r) => r.role)).toContain("critic");
    });

    it("should reach consensus when critic approves", async () => {
      mockCallGateway.mockImplementation(async (opts) => {
        if (opts.method === "agent") {
          return { runId: "run-1" };
        }
        if (opts.method === "agent.wait") {
          return { status: "ok" };
        }
        if (opts.method === "sessions.getLatestReply") {
          const key = (opts.params as { key?: string })?.key ?? "";
          if (key.includes("executor")) {
            return { content: "Implemented the feature with proper error handling." };
          }
          if (key.includes("critic")) {
            return {
              content: `Assessment: approve
              
No significant issues found. The implementation looks good.
- Proper error handling
- Clean code structure
- Well documented`,
            };
          }
        }
        return {};
      });

      const outcome = await deliberate("Add input validation", "agent:main:test-session");

      expect(outcome.consensusReached).toBe(true);
      expect(outcome.majorityVote).toBe("proceed");
      expect(outcome.conflicts).toHaveLength(0);
    });

    it("should detect conflicts when critic rejects", async () => {
      mockCallGateway.mockImplementation(async (opts) => {
        if (opts.method === "agent") {
          return { runId: "run-1" };
        }
        if (opts.method === "agent.wait") {
          return { status: "ok" };
        }
        if (opts.method === "sessions.getLatestReply") {
          const key = (opts.params as { key?: string })?.key ?? "";
          if (key.includes("executor")) {
            return { content: "Added user input directly to SQL query for flexibility." };
          }
          if (key.includes("critic")) {
            return {
              content: `Assessment: REJECT

Critical security vulnerability detected!

Issues Found:
- SQL injection vulnerability: user input is passed directly to query without sanitization
- No parameterized queries used
- This could allow attackers to access or destroy database

Recommendations:
1. Use parameterized queries or prepared statements
2. Implement input validation
3. Use an ORM that handles escaping

Do NOT proceed with this implementation.`,
            };
          }
        }
        return {};
      });

      const outcome = await deliberate("Add user search feature", "agent:main:test-session");

      expect(outcome.consensusReached).toBe(false);
      expect(outcome.majorityVote).toBe("reject");
      expect(outcome.conflicts.length).toBeGreaterThan(0);
      expect(outcome.conflicts.some((c) => c.severity === "critical")).toBe(true);
      expect(outcome.conflicts.some((c) => c.topic === "Security")).toBe(true);
    });

    it("should flag moderate concerns without blocking", async () => {
      mockCallGateway.mockImplementation(async (opts) => {
        if (opts.method === "agent") {
          return { runId: "run-1" };
        }
        if (opts.method === "agent.wait") {
          return { status: "ok" };
        }
        if (opts.method === "sessions.getLatestReply") {
          const key = (opts.params as { key?: string })?.key ?? "";
          if (key.includes("executor")) {
            return { content: "Implemented caching with 1 hour TTL." };
          }
          if (key.includes("critic")) {
            return {
              content: `Assessment: approve with concerns

The implementation looks good overall.

Concerns:
- Consider adding cache invalidation on data updates
- 1 hour TTL might be too long for frequently changing data
- No issue with the current approach for read-heavy data`,
            };
          }
        }
        return {};
      });

      const outcome = await deliberate("Add caching layer", "agent:main:test-session");

      expect(outcome.consensusReached).toBe(true);
      expect(outcome.majorityVote).toBe("proceed");
      expect(outcome.dissentingOpinions.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("quickDebate()", () => {
    it("should return simple verdict with both perspectives", async () => {
      mockCallGateway.mockImplementation(async (opts) => {
        if (opts.method === "agent") {
          return { runId: "run-1" };
        }
        if (opts.method === "agent.wait") {
          return { status: "ok" };
        }
        if (opts.method === "sessions.getLatestReply") {
          const key = (opts.params as { key?: string })?.key ?? "";
          if (key.includes("executor")) {
            return { content: "Completed the task." };
          }
          if (key.includes("critic")) {
            return { content: "No significant issues found. Approve." };
          }
        }
        return {};
      });

      const result = await quickDebate("Simple refactoring task", "agent:main:test-session");

      expect(result.verdict).toBe("proceed");
      expect(result.executorSays).toBeTruthy();
      expect(result.criticSays).toBeTruthy();
    });
  });

  describe("createDebateGuard()", () => {
    it("should allow operations when consensus not required", async () => {
      const guard = createDebateGuard("agent:main:test-session");
      const operation = vi.fn().mockResolvedValue("success");

      const result = await guard(operation, "Simple operation", { requiresConsensus: false });

      expect(result.blocked).toBe(false);
      expect(result.result).toBe("success");
      expect(operation).toHaveBeenCalled();
    });

    it("should block operations when consensus required but not reached", async () => {
      mockCallGateway.mockImplementation(async (opts) => {
        if (opts.method === "agent") {
          return { runId: "run-1" };
        }
        if (opts.method === "agent.wait") {
          return { status: "ok" };
        }
        if (opts.method === "sessions.getLatestReply") {
          const key = (opts.params as { key?: string })?.key ?? "";
          if (key.includes("executor")) {
            return { content: "Ready to deploy." };
          }
          if (key.includes("critic")) {
            return { content: "REJECT - Critical issues found. Security vulnerability." };
          }
        }
        return {};
      });

      const guard = createDebateGuard("agent:main:test-session");
      const operation = vi.fn().mockResolvedValue("deployed");

      const result = await guard(operation, "Deploy to production", { requiresConsensus: true });

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("Consensus not reached");
      expect(operation).not.toHaveBeenCalled();
    });
  });

  describe("Critic catches security issues - Integration Example", () => {
    /**
     * This test demonstrates the devil's advocate pattern in action:
     * The executor proposes a solution, and the critic catches a SQL injection vulnerability.
     */
    it("should catch SQL injection vulnerability", async () => {
      mockCallGateway.mockImplementation(async (opts) => {
        if (opts.method === "agent") {
          return { runId: "run-1" };
        }
        if (opts.method === "agent.wait") {
          return { status: "ok" };
        }
        if (opts.method === "sessions.getLatestReply") {
          const key = (opts.params as { key?: string })?.key ?? "";
          if (key.includes("executor")) {
            return {
              content: `Implemented user search endpoint:

\`\`\`javascript
app.get('/users', (req, res) => {
  const name = req.query.name;
  const query = "SELECT * FROM users WHERE name = '" + name + "'";
  db.query(query, (err, results) => {
    res.json(results);
  });
});
\`\`\`

The endpoint allows searching users by name.`,
            };
          }
          if (key.includes("critic")) {
            return {
              content: `Assessment: REJECT

## Critical Security Vulnerability

The proposed implementation contains a **SQL injection vulnerability**.

### Issues Found:
1. **Critical - SQL Injection**: User input (\`req.query.name\`) is concatenated directly into the SQL query without sanitization
2. **Critical - No Input Validation**: The endpoint accepts any string without validation

### Attack Example:
An attacker could access all users with:
\`/users?name=' OR '1'='1\`

Or drop the entire table with:
\`/users?name='; DROP TABLE users; --\`

### Recommendations:
1. Use parameterized queries:
\`\`\`javascript
const query = "SELECT * FROM users WHERE name = ?";
db.query(query, [name], callback);
\`\`\`

2. Add input validation
3. Implement rate limiting

**Do not proceed** until these issues are addressed.`,
            };
          }
        }
        return {};
      });

      const outcome = await deliberate(
        "Implement user search API endpoint",
        "agent:main:test-session",
        { requiresConsensus: true },
      );

      // Verify the critic caught the issue
      expect(outcome.consensusReached).toBe(false);
      expect(outcome.majorityVote).toBe("reject");

      // Find the critic's response
      const criticResult = outcome.agentResults.find((r) => r.role === "critic");
      expect(criticResult?.response).toContain("SQL injection");
      expect(criticResult?.response).toContain("REJECT");

      // Verify conflicts were identified
      expect(outcome.conflicts.some((c) => c.topic === "Security")).toBe(true);
      expect(outcome.conflicts.some((c) => c.severity === "critical")).toBe(true);

      console.log("\n=== Devil's Advocate Pattern Demo ===");
      console.log("\nExecutor proposed:");
      console.log(outcome.agentResults.find((r) => r.role === "executor")?.response);
      console.log("\nCritic response:");
      console.log(criticResult?.response);
      console.log("\nOutcome: BLOCKED due to security concerns");
      console.log("Conflicts:", outcome.conflicts);
    });
  });
});
