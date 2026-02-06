import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../agent-scope.js", () => ({
  resolveSessionAgentId: () => "agent-123",
}));

import { createCronTool } from "./cron-tool.js";

describe("cron tool", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    callGatewayMock.mockResolvedValue({ ok: true });
  });

  it.each([
    [
      "update",
      { action: "update", jobId: "job-1", patch: { foo: "bar" } },
      { id: "job-1", patch: { foo: "bar" } },
    ],
    [
      "update",
      { action: "update", id: "job-2", patch: { foo: "bar" } },
      { id: "job-2", patch: { foo: "bar" } },
    ],
    ["remove", { action: "remove", jobId: "job-1" }, { id: "job-1" }],
    ["remove", { action: "remove", id: "job-2" }, { id: "job-2" }],
    ["run", { action: "run", jobId: "job-1" }, { id: "job-1" }],
    ["run", { action: "run", id: "job-2" }, { id: "job-2" }],
    ["runs", { action: "runs", jobId: "job-1" }, { id: "job-1" }],
    ["runs", { action: "runs", id: "job-2" }, { id: "job-2" }],
  ])("%s sends id to gateway", async (action, args, expectedParams) => {
    const tool = createCronTool();
    await tool.execute("call1", args);

    expect(callGatewayMock).toHaveBeenCalledTimes(1);
    const call = callGatewayMock.mock.calls[0]?.[0] as {
      method?: string;
      params?: unknown;
    };
    expect(call.method).toBe(`cron.${action}`);
    expect(call.params).toEqual(expectedParams);
  });

  it("prefers jobId over id when both are provided", async () => {
    const tool = createCronTool();
    await tool.execute("call1", {
      action: "run",
      jobId: "job-primary",
      id: "job-legacy",
    });

    const call = callGatewayMock.mock.calls[0]?.[0] as {
      params?: unknown;
    };
    expect(call?.params).toEqual({ id: "job-primary" });
  });

  it("normalizes cron.add job payloads", async () => {
    const tool = createCronTool();
    await tool.execute("call2", {
      action: "add",
      job: {
        data: {
          name: "wake-up",
          schedule: { atMs: 123 },
          payload: { kind: "systemEvent", text: "hello" },
        },
      },
    });

    expect(callGatewayMock).toHaveBeenCalledTimes(1);
    const call = callGatewayMock.mock.calls[0]?.[0] as {
      method?: string;
      params?: unknown;
    };
    expect(call.method).toBe("cron.add");
    expect(call.params).toEqual({
      name: "wake-up",
      enabled: true,
      deleteAfterRun: true,
      schedule: { kind: "at", at: new Date(123).toISOString() },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "hello" },
    });
  });

  it("does not default agentId when job.agentId is null", async () => {
    const tool = createCronTool({ agentSessionKey: "main" });
    await tool.execute("call-null", {
      action: "add",
      job: {
        name: "wake-up",
        schedule: { at: new Date(123).toISOString() },
        agentId: null,
      },
    });

    const call = callGatewayMock.mock.calls[0]?.[0] as {
      params?: { agentId?: unknown };
    };
    expect(call?.params?.agentId).toBeNull();
  });

  it("adds recent context for systemEvent reminders when contextMessages > 0", async () => {
    callGatewayMock
      .mockResolvedValueOnce({
        messages: [
          { role: "user", content: [{ type: "text", text: "Discussed Q2 budget" }] },
          {
            role: "assistant",
            content: [{ type: "text", text: "We agreed to review on Tuesday." }],
          },
          { role: "user", content: [{ type: "text", text: "Remind me about the thing at 2pm" }] },
        ],
      })
      .mockResolvedValueOnce({ ok: true });

    const tool = createCronTool({ agentSessionKey: "main" });
    await tool.execute("call3", {
      action: "add",
      contextMessages: 3,
      job: {
        name: "reminder",
        schedule: { at: new Date(123).toISOString() },
        payload: { kind: "systemEvent", text: "Reminder: the thing." },
      },
    });

    expect(callGatewayMock).toHaveBeenCalledTimes(2);
    const historyCall = callGatewayMock.mock.calls[0]?.[0] as {
      method?: string;
      params?: unknown;
    };
    expect(historyCall.method).toBe("chat.history");

    const cronCall = callGatewayMock.mock.calls[1]?.[0] as {
      method?: string;
      params?: { payload?: { text?: string } };
    };
    expect(cronCall.method).toBe("cron.add");
    const text = cronCall.params?.payload?.text ?? "";
    expect(text).toContain("Recent context:");
    expect(text).toContain("User: Discussed Q2 budget");
    expect(text).toContain("Assistant: We agreed to review on Tuesday.");
    expect(text).toContain("User: Remind me about the thing at 2pm");
  });

  it("caps contextMessages at 10", async () => {
    const messages = Array.from({ length: 12 }, (_, idx) => ({
      role: "user",
      content: [{ type: "text", text: `Message ${idx + 1}` }],
    }));
    callGatewayMock.mockResolvedValueOnce({ messages }).mockResolvedValueOnce({ ok: true });

    const tool = createCronTool({ agentSessionKey: "main" });
    await tool.execute("call5", {
      action: "add",
      contextMessages: 20,
      job: {
        name: "reminder",
        schedule: { at: new Date(123).toISOString() },
        payload: { kind: "systemEvent", text: "Reminder: the thing." },
      },
    });

    expect(callGatewayMock).toHaveBeenCalledTimes(2);
    const historyCall = callGatewayMock.mock.calls[0]?.[0] as {
      method?: string;
      params?: { limit?: number };
    };
    expect(historyCall.method).toBe("chat.history");
    expect(historyCall.params?.limit).toBe(10);

    const cronCall = callGatewayMock.mock.calls[1]?.[0] as {
      params?: { payload?: { text?: string } };
    };
    const text = cronCall.params?.payload?.text ?? "";
    expect(text).not.toMatch(/Message 1\\b/);
    expect(text).not.toMatch(/Message 2\\b/);
    expect(text).toContain("Message 3");
    expect(text).toContain("Message 12");
  });

  it("does not add context when contextMessages is 0 (default)", async () => {
    callGatewayMock.mockResolvedValueOnce({ ok: true });

    const tool = createCronTool({ agentSessionKey: "main" });
    await tool.execute("call4", {
      action: "add",
      job: {
        name: "reminder",
        schedule: { at: new Date(123).toISOString() },
        payload: { text: "Reminder: the thing." },
      },
    });

    // Should only call cron.add, not chat.history
    expect(callGatewayMock).toHaveBeenCalledTimes(1);
    const cronCall = callGatewayMock.mock.calls[0]?.[0] as {
      method?: string;
      params?: { payload?: { text?: string } };
    };
    expect(cronCall.method).toBe("cron.add");
    const text = cronCall.params?.payload?.text ?? "";
    expect(text).not.toContain("Recent context:");
  });

  it("preserves explicit agentId null on add", async () => {
    callGatewayMock.mockResolvedValueOnce({ ok: true });

    const tool = createCronTool({ agentSessionKey: "main" });
    await tool.execute("call6", {
      action: "add",
      job: {
        name: "reminder",
        schedule: { at: new Date(123).toISOString() },
        agentId: null,
        payload: { kind: "systemEvent", text: "Reminder: the thing." },
      },
    });

    const call = callGatewayMock.mock.calls[0]?.[0] as {
      method?: string;
      params?: { agentId?: string | null };
    };
    expect(call.method).toBe("cron.add");
    expect(call.params?.agentId).toBeNull();
  });

  describe("camp action", () => {
    it("creates camping job with webhook condition", async () => {
      callGatewayMock.mockResolvedValueOnce({ ok: true, data: { id: "job-camp-123" } });

      const tool = createCronTool({ agentSessionKey: "main" });
      await tool.execute("call-camp", {
        action: "camp",
        wakeMessage: "PR was merged",
        condition: {
          kind: "webhook",
          endpoint: "/hooks/github/pr-merged",
          filter: { repo: "owner/repo" },
        },
        timeoutMinutes: 60,
      });

      expect(callGatewayMock).toHaveBeenCalledTimes(1);
      const call = callGatewayMock.mock.calls[0]?.[0] as {
        method?: string;
        params?: {
          name?: string;
          description?: string;
          schedule?: { kind: string; at: string };
          sessionTarget?: string;
          wakeMode?: string;
          payload?: { kind: string; message?: string };
          delivery?: { mode?: string };
          enabled?: boolean;
          agentId?: string;
          metadata?: { condition?: unknown; camping?: boolean };
        };
      };

      expect(call.method).toBe("cron.add");
      expect(call.params?.name).toContain("Camp: PR was merged");
      expect(call.params?.description).toContain("Camping job waiting for condition");
      expect(call.params?.schedule?.kind).toBe("at");
      expect(call.params?.sessionTarget).toBe("isolated");
      expect(call.params?.wakeMode).toBe("now");
      expect(call.params?.payload?.kind).toBe("agentTurn");
      expect(call.params?.payload?.message).toBe("PR was merged");
      expect(call.params?.delivery?.mode).toBe("announce");
      expect(call.params?.enabled).toBe(true);
      expect(call.params?.agentId).toBe("agent-123");
      expect(call.params?.metadata?.camping).toBe(true);
      expect(call.params?.metadata?.condition).toEqual({
        kind: "webhook",
        endpoint: "/hooks/github/pr-merged",
        filter: { repo: "owner/repo" },
      });
    });

    it("uses default timeout of 60 minutes when not specified", async () => {
      callGatewayMock.mockResolvedValueOnce({ ok: true });

      const tool = createCronTool();
      await tool.execute("call-camp-default", {
        action: "camp",
        wakeMessage: "Build completed",
        condition: {
          kind: "webhook",
          endpoint: "/hooks/build",
        },
      });

      const call = callGatewayMock.mock.calls[0]?.[0] as {
        params?: { schedule?: { at: string } };
      };

      const scheduledAt = new Date(call.params?.schedule?.at ?? "");
      const now = new Date();
      const timeoutMs = scheduledAt.getTime() - now.getTime();

      // Should be approximately 60 minutes (allow 1 second tolerance)
      expect(timeoutMs).toBeGreaterThan(59 * 60 * 1000);
      expect(timeoutMs).toBeLessThan(61 * 60 * 1000);
    });

    it("uses custom timeout when specified", async () => {
      callGatewayMock.mockResolvedValueOnce({ ok: true });

      const tool = createCronTool();
      await tool.execute("call-camp-custom", {
        action: "camp",
        wakeMessage: "Deployment finished",
        condition: {
          kind: "webhook",
          endpoint: "/hooks/deploy",
        },
        timeoutMinutes: 30,
      });

      const call = callGatewayMock.mock.calls[0]?.[0] as {
        params?: { schedule?: { at: string } };
      };

      const scheduledAt = new Date(call.params?.schedule?.at ?? "");
      const now = new Date();
      const timeoutMs = scheduledAt.getTime() - now.getTime();

      // Should be approximately 30 minutes
      expect(timeoutMs).toBeGreaterThan(29 * 60 * 1000);
      expect(timeoutMs).toBeLessThan(31 * 60 * 1000);
    });

    it("truncates wake message in job name to 50 characters", async () => {
      callGatewayMock.mockResolvedValueOnce({ ok: true });

      const tool = createCronTool();
      const longMessage = "A".repeat(100);
      await tool.execute("call-camp-long", {
        action: "camp",
        wakeMessage: longMessage,
        condition: {
          kind: "webhook",
          endpoint: "/hooks/test",
        },
      });

      const call = callGatewayMock.mock.calls[0]?.[0] as {
        params?: { name?: string };
      };

      expect(call.params?.name).toBe(`Camp: ${"A".repeat(50)}`);
      expect(call.params?.name?.length).toBeLessThanOrEqual(56); // "Camp: " + 50 chars
    });

    it("requires condition parameter", async () => {
      const tool = createCronTool();

      await expect(
        tool.execute("call-camp-no-condition", {
          action: "camp",
          wakeMessage: "Test",
        }),
      ).rejects.toThrow("condition required for camp action");
    });

    it("requires wakeMessage parameter", async () => {
      const tool = createCronTool();

      await expect(
        tool.execute("call-camp-no-message", {
          action: "camp",
          condition: {
            kind: "webhook",
            endpoint: "/hooks/test",
          },
        }),
      ).rejects.toThrow();
    });

    it("sets agentId from session key when provided", async () => {
      callGatewayMock.mockResolvedValueOnce({ ok: true });

      const tool = createCronTool({ agentSessionKey: "main" });
      await tool.execute("call-camp-session", {
        action: "camp",
        wakeMessage: "Wake up",
        condition: {
          kind: "webhook",
          endpoint: "/hooks/test",
        },
      });

      const call = callGatewayMock.mock.calls[0]?.[0] as {
        params?: { agentId?: string };
      };

      expect(call.params?.agentId).toBe("agent-123");
    });

    it("does not set agentId when session key not provided", async () => {
      callGatewayMock.mockResolvedValueOnce({ ok: true });

      const tool = createCronTool();
      await tool.execute("call-camp-no-session", {
        action: "camp",
        wakeMessage: "Wake up",
        condition: {
          kind: "webhook",
          endpoint: "/hooks/test",
        },
      });

      const call = callGatewayMock.mock.calls[0]?.[0] as {
        params?: { agentId?: string };
      };

      expect(call.params?.agentId).toBeUndefined();
    });
  });
});
