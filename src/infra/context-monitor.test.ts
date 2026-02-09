/**
 * Tests for Context Monitor — Phase 2 Monitoring Infrastructure
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ContextMonitor,
  getContextMonitor,
  resetContextMonitor,
  CONTEXT_THRESHOLD_WARNING,
  CONTEXT_THRESHOLD_CRITICAL,
} from "./context-monitor.js";

describe("ContextMonitor", () => {
  let monitor: ContextMonitor;

  beforeEach(() => {
    resetContextMonitor();
    monitor = new ContextMonitor({
      metricsDir: "/tmp/context-monitor-test",
    });
  });

  describe("recordMetrics", () => {
    it("records metrics without triggering alerts when under threshold", () => {
      let alertTriggered = false;
      monitor.on("threshold", () => {
        alertTriggered = true;
      });

      const metrics = monitor.recordMetrics({
        sessionKey: "test-session",
        tokenCount: 50000,
        messageCount: 10,
      });

      expect(metrics.tokenCount).toBe(50000);
      expect(metrics.thresholdExceeded).toBe(false);
      expect(alertTriggered).toBe(false);
    });

    it("triggers warning alert when exceeding warning threshold", () => {
      let alertSeverity: string | null = null;
      monitor.on("warning", (alert) => {
        alertSeverity = alert.severity;
      });

      monitor.recordMetrics({
        sessionKey: "test-session",
        tokenCount: CONTEXT_THRESHOLD_WARNING + 1000,
        messageCount: 50,
      });

      expect(alertSeverity).toBe("warning");
    });

    it("triggers critical alert when exceeding critical threshold", () => {
      let alertSeverity: string | null = null;
      monitor.on("critical", (alert) => {
        alertSeverity = alert.severity;
      });

      monitor.recordMetrics({
        sessionKey: "test-session",
        tokenCount: CONTEXT_THRESHOLD_CRITICAL + 1000,
        messageCount: 100,
      });

      expect(alertSeverity).toBe("critical");
    });
  });

  describe("recordSummarizationComplete", () => {
    it("records summarization efficiency", () => {
      let reportReceived = false;
      monitor.on("summarizationComplete", () => {
        reportReceived = true;
      });

      monitor.recordSummarizationComplete({
        sessionKey: "test-session",
        startTokens: 100000,
        endTokens: 40000,
        tokensSaved: 60000,
        compressionRatio: 0.4,
        summarizationDuration: 500,
      });

      expect(reportReceived).toBe(true);
    });
  });

  describe("getSessionPattern", () => {
    it("tracks session patterns across multiple recordings", () => {
      monitor.recordMetrics({
        sessionKey: "test-session",
        tokenCount: 30000,
        messageCount: 10,
      });

      monitor.recordMetrics({
        sessionKey: "test-session",
        tokenCount: 60000,
        messageCount: 20,
      });

      monitor.recordMetrics({
        sessionKey: "test-session",
        tokenCount: 90000,
        messageCount: 30,
      });

      const pattern = monitor.getSessionPattern("test-session");

      expect(pattern).toBeDefined();
      expect(pattern!.peakTokenCount).toBe(90000);
      expect(pattern!.avgTokenCount).toBe(60000);
      expect(pattern!.alertCount).toBe(1); // Only 90k exceeds threshold
    });
  });

  describe("getThresholds", () => {
    it("returns configured thresholds", () => {
      const thresholds = monitor.getThresholds();

      expect(thresholds.warning).toBe(CONTEXT_THRESHOLD_WARNING);
      expect(thresholds.critical).toBe(CONTEXT_THRESHOLD_CRITICAL);
    });

    it("supports custom thresholds", () => {
      const customMonitor = new ContextMonitor({
        warningThreshold: 50000,
        criticalThreshold: 100000,
        metricsDir: "/tmp/context-monitor-test",
      });

      const thresholds = customMonitor.getThresholds();

      expect(thresholds.warning).toBe(50000);
      expect(thresholds.critical).toBe(100000);
    });
  });

  describe("clearSession", () => {
    it("clears session metrics and patterns", () => {
      monitor.recordMetrics({
        sessionKey: "test-session",
        tokenCount: 50000,
        messageCount: 10,
      });

      expect(monitor.getSessionMetrics("test-session").length).toBeGreaterThan(0);

      monitor.clearSession("test-session");

      expect(monitor.getSessionMetrics("test-session").length).toBe(0);
      expect(monitor.getSessionPattern("test-session")).toBeUndefined();
    });
  });
});

describe("getContextMonitor singleton", () => {
  beforeEach(() => {
    resetContextMonitor();
  });

  it("returns the same instance on multiple calls", () => {
    const monitor1 = getContextMonitor();
    const monitor2 = getContextMonitor();

    expect(monitor1).toBe(monitor2);
  });

  it("returns new instance after reset", () => {
    const monitor1 = getContextMonitor();
    resetContextMonitor();
    const monitor2 = getContextMonitor();

    expect(monitor1).not.toBe(monitor2);
  });
});
