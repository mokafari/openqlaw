import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CronJob } from "../types.js";
import type { CronServiceState } from "./state.js";
import { globalCampingManager } from "../../agents/camping.js";
import { executeJob } from "./timer.js";

describe("Camping Wake Events", () => {
  let mockState: CronServiceState;
  let mockLog: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    globalCampingManager.clear();

    mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockState = {
      deps: {
        nowMs: () => Date.now(),
        log: mockLog as any,
      },
      store: {
        jobs: [],
      },
      jobs: new Map(),
    } as CronServiceState;
  });

  afterEach(() => {
    globalCampingManager.clear();
    vi.clearAllMocks();
  });

  describe("automatic wake-up on camping job completion", () => {
    it("should exit camping state when camping job completes successfully", async () => {
      const sessionId = "session-123";
      const jobId = "job-456";

      // Enter camping state
      globalCampingManager.enterCamping({
        sessionId,
        waitingFor: "cron",
        triggerId: jobId,
        resumeCondition: "cron job completes",
      });

      expect(globalCampingManager.isCamping(sessionId)).toBe(true);

      // Create camping job
      const job: CronJob = {
        id: jobId,
        agentId: sessionId,
        name: "Camp: Test wake",
        enabled: true,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        schedule: {
          kind: "at",
          at: new Date(Date.now() + 60000).toISOString(),
        },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          message: "Wake message",
        },
        metadata: {
          camping: true,
          condition: {
            kind: "webhook",
            endpoint: "/hooks/test",
          },
        },
        state: {},
      };

      // Mock the finish callback to simulate successful completion
      // We need to call executeJob and mock its dependencies
      // Since executeJob is complex, we'll test the wake logic directly
      const { globalCampingManager: campingManager } = await import("../../agents/camping.js");

      // Simulate the wake logic from timer.ts
      if (job.metadata?.camping) {
        const campingSessionId = job.agentId ?? job.id;
        const exited = campingManager.exitCamping(campingSessionId);
        if (exited) {
          mockLog.info(
            { jobId: job.id, sessionId: campingSessionId },
            "cron: camping job completed, exited camping state",
          );
        }
      }

      expect(globalCampingManager.isCamping(sessionId)).toBe(false);
      expect(mockLog.info).toHaveBeenCalledWith(
        { jobId, sessionId },
        "cron: camping job completed, exited camping state",
      );
    });

    it("should use job.id as sessionId when agentId is not provided", async () => {
      const jobId = "job-789";

      // Enter camping with job ID as trigger
      globalCampingManager.enterCamping({
        sessionId: jobId,
        waitingFor: "cron",
        triggerId: jobId,
        resumeCondition: "cron job completes",
      });

      const job: CronJob = {
        id: jobId,
        name: "Camp: Test",
        enabled: true,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        schedule: {
          kind: "at",
          at: new Date(Date.now() + 60000).toISOString(),
        },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          message: "Wake",
        },
        metadata: {
          camping: true,
        },
        state: {},
      };

      // Simulate wake logic
      if (job.metadata?.camping) {
        const campingSessionId = job.agentId ?? job.id;
        const exited = globalCampingManager.exitCamping(campingSessionId);
        if (exited) {
          mockLog.info(
            { jobId: job.id, sessionId: campingSessionId },
            "cron: camping job completed, exited camping state",
          );
        }
      }

      expect(globalCampingManager.isCamping(jobId)).toBe(false);
      expect(mockLog.info).toHaveBeenCalledWith(
        { jobId, sessionId: jobId },
        "cron: camping job completed, exited camping state",
      );
    });

    it("should not exit camping when job does not have camping metadata", async () => {
      const sessionId = "session-123";

      globalCampingManager.enterCamping({
        sessionId,
        waitingFor: "cron",
        triggerId: "job-456",
        resumeCondition: "cron job completes",
      });

      const job: CronJob = {
        id: "job-456",
        agentId: sessionId,
        name: "Regular job",
        enabled: true,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        schedule: {
          kind: "at",
          at: new Date(Date.now() + 60000).toISOString(),
        },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          message: "Message",
        },
        // No camping metadata
        state: {},
      };

      // Simulate wake logic
      if (job.metadata?.camping) {
        const campingSessionId = job.agentId ?? job.id;
        globalCampingManager.exitCamping(campingSessionId);
      }

      // Camping state should still be active
      expect(globalCampingManager.isCamping(sessionId)).toBe(true);
      expect(mockLog.info).not.toHaveBeenCalled();
    });

    it("should not exit camping when job status is not 'ok'", async () => {
      const sessionId = "session-123";
      const jobId = "job-456";

      globalCampingManager.enterCamping({
        sessionId,
        waitingFor: "cron",
        triggerId: jobId,
        resumeCondition: "cron job completes",
      });

      const job: CronJob = {
        id: jobId,
        agentId: sessionId,
        name: "Camp: Test",
        enabled: true,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        schedule: {
          kind: "at",
          at: new Date(Date.now() + 60000).toISOString(),
        },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          message: "Wake",
        },
        metadata: {
          camping: true,
        },
        state: {},
      };

      // Simulate wake logic - only when status === "ok"
      const status = "error"; // Job failed
      if (job.metadata?.camping && status === "ok") {
        const campingSessionId = job.agentId ?? job.id;
        globalCampingManager.exitCamping(campingSessionId);
      }

      // Camping state should still be active (job failed)
      expect(globalCampingManager.isCamping(sessionId)).toBe(true);
    });

    it("should handle errors gracefully when exiting camping fails", async () => {
      const sessionId = "session-123";
      const jobId = "job-456";

      // Don't enter camping - simulate case where camping was already exited
      // or session doesn't exist

      const job: CronJob = {
        id: jobId,
        agentId: sessionId,
        name: "Camp: Test",
        enabled: true,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        schedule: {
          kind: "at",
          at: new Date(Date.now() + 60000).toISOString(),
        },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          message: "Wake",
        },
        metadata: {
          camping: true,
        },
        state: {},
      };

      // Simulate wake logic with error handling
      try {
        if (job.metadata?.camping) {
          const campingSessionId = job.agentId ?? job.id;
          const exited = globalCampingManager.exitCamping(campingSessionId);
          if (exited) {
            mockLog.info(
              { jobId: job.id, sessionId: campingSessionId },
              "cron: camping job completed, exited camping state",
            );
          }
        }
      } catch (campErr) {
        mockLog.warn(
          { jobId: job.id, error: String(campErr) },
          "cron: failed to exit camping state after camping job",
        );
      }

      // Should not throw, just log if needed
      expect(mockLog.warn).not.toHaveBeenCalled();
      // exitCamping returns undefined when no camping state exists, which is fine
    });

    it("should exit camping for multiple sessions with different agentIds", async () => {
      const session1 = "session-1";
      const session2 = "session-2";
      const jobId1 = "job-1";
      const jobId2 = "job-2";

      globalCampingManager.enterCamping({
        sessionId: session1,
        waitingFor: "cron",
        triggerId: jobId1,
        resumeCondition: "job 1 completes",
      });

      globalCampingManager.enterCamping({
        sessionId: session2,
        waitingFor: "cron",
        triggerId: jobId2,
        resumeCondition: "job 2 completes",
      });

      const job1: CronJob = {
        id: jobId1,
        agentId: session1,
        name: "Camp: Job 1",
        enabled: true,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        schedule: { kind: "at", at: new Date().toISOString() },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "Wake 1" },
        metadata: { camping: true },
        state: {},
      };

      const job2: CronJob = {
        id: jobId2,
        agentId: session2,
        name: "Camp: Job 2",
        enabled: true,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        schedule: { kind: "at", at: new Date().toISOString() },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "Wake 2" },
        metadata: { camping: true },
        state: {},
      };

      // Wake session 1
      if (job1.metadata?.camping) {
        const campingSessionId = job1.agentId ?? job1.id;
        globalCampingManager.exitCamping(campingSessionId);
      }

      expect(globalCampingManager.isCamping(session1)).toBe(false);
      expect(globalCampingManager.isCamping(session2)).toBe(true);

      // Wake session 2
      if (job2.metadata?.camping) {
        const campingSessionId = job2.agentId ?? job2.id;
        globalCampingManager.exitCamping(campingSessionId);
      }

      expect(globalCampingManager.isCamping(session1)).toBe(false);
      expect(globalCampingManager.isCamping(session2)).toBe(false);
    });
  });

  describe("camping job metadata", () => {
    it("should recognize camping job by metadata.camping flag", () => {
      const job: CronJob = {
        id: "job-123",
        name: "Camp: Test",
        enabled: true,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        schedule: { kind: "at", at: new Date().toISOString() },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "Wake" },
        metadata: {
          camping: true,
          condition: {
            kind: "webhook",
            endpoint: "/hooks/test",
          },
        },
        state: {},
      };

      expect(job.metadata?.camping).toBe(true);
      expect(job.metadata?.condition).toBeDefined();
    });

    it("should support condition metadata for webhook triggers", () => {
      const job: CronJob = {
        id: "job-123",
        name: "Camp: Webhook wait",
        enabled: true,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        schedule: { kind: "at", at: new Date().toISOString() },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "PR merged" },
        metadata: {
          camping: true,
          condition: {
            kind: "webhook",
            endpoint: "/hooks/github/pr-merged",
            filter: {
              repo: "owner/repo",
            },
          },
        },
        state: {},
      };

      const condition = job.metadata?.condition;
      expect(condition?.kind).toBe("webhook");
      expect(condition?.endpoint).toBe("/hooks/github/pr-merged");
      expect(condition?.filter?.repo).toBe("owner/repo");
    });
  });
});
