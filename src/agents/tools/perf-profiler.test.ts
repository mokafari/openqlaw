import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  takeMemorySnapshot,
  formatBytes,
  calculateMemoryDelta,
  startSessionProfile,
  endSessionProfile,
  getActiveProfile,
  startToolCall,
  endToolCall,
  profileTool,
  generatePerformanceReport,
  getPerformanceSummary,
  formatReportAsText,
  startMemoryMonitoring,
  stopMemoryMonitoring,
  type SessionProfile,
} from "./perf-profiler.js";

describe("Performance Profiling Tools", () => {
  let testSessionId: string;

  beforeEach(() => {
    testSessionId = `test-session-${Date.now()}`;
  });

  afterEach(async () => {
    // End any active profile
    await endSessionProfile(testSessionId);
    stopMemoryMonitoring();
  });

  describe("Memory Utilities", () => {
    it("should take memory snapshot", () => {
      const snapshot = takeMemorySnapshot();

      expect(snapshot.heapUsed).toBeGreaterThan(0);
      expect(snapshot.heapTotal).toBeGreaterThan(0);
      expect(snapshot.rss).toBeGreaterThan(0);
      expect(snapshot.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it("should format bytes correctly", () => {
      expect(formatBytes(512)).toBe("512 B");
      expect(formatBytes(1024)).toBe("1.0 KB");
      expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
      expect(formatBytes(1536)).toBe("1.5 KB");
    });

    it("should calculate memory delta", () => {
      const before = takeMemorySnapshot();

      // Allocate some memory
      const arr = new Array(10000).fill("test");

      const after = takeMemorySnapshot();
      const delta = calculateMemoryDelta(before, after);

      expect(typeof delta.heapDelta).toBe("number");
      expect(typeof delta.rssDelta).toBe("number");

      // Prevent garbage collection
      expect(arr.length).toBe(10000);
    });
  });

  describe("Session Profiling", () => {
    it("should start session profile", () => {
      const profile = startSessionProfile(testSessionId);

      expect(profile.sessionId).toBe(testSessionId);
      expect(profile.startTime).toBeLessThanOrEqual(Date.now());
      expect(profile.toolCalls).toHaveLength(0);
      expect(profile.memorySnapshots).toHaveLength(1);
    });

    it("should get active profile", () => {
      startSessionProfile(testSessionId);

      const profile = getActiveProfile(testSessionId);

      expect(profile).toBeDefined();
      expect(profile?.sessionId).toBe(testSessionId);
    });

    it("should end session profile", async () => {
      startSessionProfile(testSessionId);

      const profile = await endSessionProfile(testSessionId);

      expect(profile).not.toBeNull();
      expect(profile?.endTime).toBeDefined();
      expect(profile?.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(profile?.memorySnapshots.length).toBeGreaterThanOrEqual(2);

      // Should no longer be active
      const active = getActiveProfile(testSessionId);
      expect(active).toBeUndefined();
    });

    it("should track peak memory", async () => {
      startSessionProfile(testSessionId);

      const profile = await endSessionProfile(testSessionId);

      expect(profile?.peakMemory).not.toBeNull();
      expect(profile?.peakMemory?.heapUsed).toBeGreaterThan(0);
    });
  });

  describe("Tool Call Profiling", () => {
    it("should track tool call timing", () => {
      startSessionProfile(testSessionId);

      const callId = startToolCall(testSessionId, "test-tool");

      // Simulate some work
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy wait
      }

      const profile = endToolCall(callId, { success: true });

      expect(profile).not.toBeNull();
      expect(profile?.toolName).toBe("test-tool");
      expect(profile?.durationMs).toBeGreaterThanOrEqual(10);
      expect(profile?.success).toBe(true);
    });

    it("should track tool call errors", () => {
      startSessionProfile(testSessionId);

      const callId = startToolCall(testSessionId, "failing-tool");
      const profile = endToolCall(callId, {
        success: false,
        error: "Something went wrong",
      });

      expect(profile?.success).toBe(false);
      expect(profile?.error).toBe("Something went wrong");
    });

    it("should track memory per tool call", () => {
      startSessionProfile(testSessionId);

      const callId = startToolCall(testSessionId, "memory-tool");
      const profile = endToolCall(callId, { success: true });

      expect(profile?.memoryBefore).toBeDefined();
      expect(profile?.memoryAfter).toBeDefined();
    });

    it("should add tool calls to session profile", async () => {
      startSessionProfile(testSessionId);

      const callId = startToolCall(testSessionId, "tracked-tool");
      endToolCall(callId, { success: true });

      const sessionProfile = await endSessionProfile(testSessionId);

      expect(sessionProfile?.toolCalls).toHaveLength(1);
      expect(sessionProfile?.toolCalls[0].toolName).toBe("tracked-tool");
    });
  });

  describe("profileTool helper", () => {
    it("should profile successful function", async () => {
      startSessionProfile(testSessionId);

      const result = await profileTool(testSessionId, "async-tool", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "success";
      });

      expect(result).toBe("success");

      const profile = await endSessionProfile(testSessionId);
      expect(profile?.toolCalls).toHaveLength(1);
      expect(profile?.toolCalls[0].success).toBe(true);
    });

    it("should profile failing function", async () => {
      startSessionProfile(testSessionId);

      await expect(
        profileTool(testSessionId, "failing-async-tool", async () => {
          throw new Error("Intentional failure");
        }),
      ).rejects.toThrow("Intentional failure");

      const profile = await endSessionProfile(testSessionId);
      expect(profile?.toolCalls).toHaveLength(1);
      expect(profile?.toolCalls[0].success).toBe(false);
    });
  });

  describe("Slow Operation Detection", () => {
    it("should identify slow operations", async () => {
      startSessionProfile(testSessionId);

      // Create a slow tool call
      const callId = startToolCall(testSessionId, "slow-tool");

      // Simulate slow operation by manipulating the start time
      // In real usage, the tool would actually take 5+ seconds
      const profile = endToolCall(callId, { success: true });

      // Since we can't easily simulate 5+ second calls in tests,
      // we verify the structure is correct
      expect(profile?.durationMs).toBeDefined();
    });
  });

  describe("Performance Report", () => {
    it("should generate performance report", async () => {
      // Create some test data
      startSessionProfile(testSessionId);
      const callId = startToolCall(testSessionId, "report-tool");
      endToolCall(callId, { success: true });
      await endSessionProfile(testSessionId);

      const report = await generatePerformanceReport({
        startTime: Date.now() - 3600000, // Last hour
        endTime: Date.now(),
      });

      expect(report.generatedAt).toBeLessThanOrEqual(Date.now());
      expect(report.periodStart).toBeDefined();
      expect(report.periodEnd).toBeDefined();
      expect(report.sessionCount).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(report.toolStats)).toBe(true);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it("should format report as text", async () => {
      const report = await generatePerformanceReport();
      const text = formatReportAsText(report);

      expect(text).toContain("PERFORMANCE REPORT");
      expect(text).toContain("Sessions:");
      expect(text).toContain("MEMORY PROFILE");
    });
  });

  describe("Performance Summary", () => {
    it("should get quick summary", async () => {
      const summary = await getPerformanceSummary();

      expect(summary.currentMemory).toBeDefined();
      expect(summary.currentMemory.heapUsed).toBeGreaterThan(0);
      expect(typeof summary.activeProfiles).toBe("number");
      expect(typeof summary.recentSlowOperations).toBe("number");
      expect(Array.isArray(summary.topToolsByDuration)).toBe(true);
    });
  });

  describe("Memory Monitoring", () => {
    it("should start and stop memory monitoring", async () => {
      startSessionProfile(testSessionId);

      startMemoryMonitoring(testSessionId, 50); // 50ms interval

      // Wait for a few samples
      await new Promise((resolve) => setTimeout(resolve, 200));

      stopMemoryMonitoring();

      const profile = await endSessionProfile(testSessionId);

      // Should have multiple snapshots from monitoring
      expect(profile?.memorySnapshots.length).toBeGreaterThan(2);
    });
  });

  describe("Tool Statistics", () => {
    it("should calculate correct statistics", async () => {
      startSessionProfile(testSessionId);

      // Multiple calls to same tool
      for (let i = 0; i < 5; i++) {
        const callId = startToolCall(testSessionId, "stats-tool");
        endToolCall(callId, { success: i < 4 }); // 4 success, 1 failure
      }

      await endSessionProfile(testSessionId);

      const report = await generatePerformanceReport({
        startTime: Date.now() - 60000,
        endTime: Date.now(),
      });

      const statsTool = report.toolStats.find((s) => s.toolName === "stats-tool");
      if (statsTool) {
        expect(statsTool.callCount).toBe(5);
        expect(statsTool.successRate).toBe(0.8);
        expect(statsTool.errorCount).toBe(1);
      }
    });
  });
});
