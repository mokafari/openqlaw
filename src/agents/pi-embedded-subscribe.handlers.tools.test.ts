import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddedPiSubscribeContext } from "./pi-embedded-subscribe.handlers.types.js";
import { DEFAULT_SYNONYMS } from "./personality/synonyms.js";
import { handleToolExecutionEnd } from "./pi-embedded-subscribe.handlers.tools.js";

describe("handleToolExecutionEnd", () => {
  let ctx: EmbeddedPiSubscribeContext;
  let onToolResult: ReturnType<typeof vi.fn>;
  let shouldEmitToolResult: ReturnType<typeof vi.fn>;
  let log: { debug: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    onToolResult = vi.fn();
    shouldEmitToolResult = vi.fn().mockReturnValue(true);
    log = {
      debug: vi.fn(),
      warn: vi.fn(),
    };

    ctx = {
      params: {
        runId: "test-run-123",
        onToolResult,
        synonymDictionary: DEFAULT_SYNONYMS,
      },
      state: {
        assistantTexts: [],
        toolMetas: [],
        toolMetaById: new Map(),
        toolSummaryById: new Set(),
        lastToolError: undefined,
        toolErrors: [],
        blockReplyBreak: "text_end",
        reasoningMode: "off",
        includeReasoning: false,
        shouldEmitPartialReplies: false,
        streamReasoning: false,
        deltaBuffer: "",
        blockBuffer: "",
        blockState: { thinking: false, final: false, inlineCode: { open: false } },
        partialBlockState: { thinking: false, final: false, inlineCode: { open: false } },
        emittedAssistantUpdate: false,
        assistantMessageIndex: 0,
        lastAssistantTextMessageIndex: -1,
        assistantTextBaseline: 0,
        suppressBlockChunks: false,
        compactionInFlight: false,
        pendingCompactionRetry: 0,
        compactionRetryPromise: null,
        messagingToolSentTexts: [],
        messagingToolSentTextsNormalized: [],
        messagingToolSentTargets: [],
        pendingMessagingTexts: new Map(),
        pendingMessagingTargets: new Map(),
      },
      log,
      shouldEmitToolResult,
      shouldEmitToolOutput: vi.fn().mockReturnValue(false),
      emitToolSummary: vi.fn(),
      emitToolOutput: vi.fn(),
      stripBlockTags: vi.fn((text) => text),
      emitBlockChunk: vi.fn(),
      flushBlockReplyBuffer: vi.fn(),
      emitReasoningStream: vi.fn(),
      consumeReplyDirectives: vi.fn(),
      consumePartialReplyDirectives: vi.fn(),
      resetAssistantMessageState: vi.fn(),
      resetForCompactionRetry: vi.fn(),
      finalizeAssistantTexts: vi.fn(),
      trimMessagingToolSent: vi.fn(),
      ensureCompactionPromise: vi.fn(),
      noteCompactionRetry: vi.fn(),
      resolveCompactionRetry: vi.fn(),
      maybeResolveCompactionWait: vi.fn(),
      blockChunker: null,
    };
  });

  it("should emit formatToolSuccess message when tool completes successfully with synonym dictionary", () => {
    const evt: AgentEvent & {
      toolName: string;
      toolCallId: string;
      isError: boolean;
      result?: unknown;
    } = {
      type: "tool_execution_end",
      toolName: "read",
      toolCallId: "call-1",
      isError: false,
      result: { content: [{ type: "text", text: "file content" }] },
    };

    handleToolExecutionEnd(ctx, evt);

    expect(onToolResult).toHaveBeenCalledTimes(1);
    const call = onToolResult.mock.calls[0][0];
    expect(call.text).toMatch(/^(Done\.|Task complete\.|Got it\.) read completed successfully\.$/);
  });

  it("should not emit formatToolSuccess when tool fails", () => {
    const evt: AgentEvent & {
      toolName: string;
      toolCallId: string;
      isError: boolean;
      result?: unknown;
    } = {
      type: "tool_execution_end",
      toolName: "read",
      toolCallId: "call-1",
      isError: true,
      result: { error: "File not found" },
    };

    handleToolExecutionEnd(ctx, evt);

    // Should not call onToolResult for success message on error
    expect(onToolResult).not.toHaveBeenCalled();
  });

  it("should not emit formatToolSuccess when synonym dictionary is not provided", () => {
    ctx.params.synonymDictionary = undefined;

    const evt: AgentEvent & {
      toolName: string;
      toolCallId: string;
      isError: boolean;
      result?: unknown;
    } = {
      type: "tool_execution_end",
      toolName: "read",
      toolCallId: "call-1",
      isError: false,
      result: { content: [{ type: "text", text: "file content" }] },
    };

    handleToolExecutionEnd(ctx, evt);

    // Should not call onToolResult for success message without synonym dictionary
    expect(onToolResult).not.toHaveBeenCalled();
  });

  it("should not emit formatToolSuccess when shouldEmitToolResult returns false", () => {
    shouldEmitToolResult.mockReturnValue(false);

    const evt: AgentEvent & {
      toolName: string;
      toolCallId: string;
      isError: boolean;
      result?: unknown;
    } = {
      type: "tool_execution_end",
      toolName: "read",
      toolCallId: "call-1",
      isError: false,
      result: { content: [{ type: "text", text: "file content" }] },
    };

    handleToolExecutionEnd(ctx, evt);

    expect(onToolResult).not.toHaveBeenCalled();
  });

  it("should handle onToolResult errors gracefully", () => {
    onToolResult.mockImplementation(() => {
      throw new Error("Delivery failed");
    });

    const evt: AgentEvent & {
      toolName: string;
      toolCallId: string;
      isError: boolean;
      result?: unknown;
    } = {
      type: "tool_execution_end",
      toolName: "read",
      toolCallId: "call-1",
      isError: false,
      result: { content: [{ type: "text", text: "file content" }] },
    };

    // Should not throw
    expect(() => handleToolExecutionEnd(ctx, evt)).not.toThrow();
  });

  it("should work with different tool names", () => {
    const evt: AgentEvent & {
      toolName: string;
      toolCallId: string;
      isError: boolean;
      result?: unknown;
    } = {
      type: "tool_execution_end",
      toolName: "write",
      toolCallId: "call-2",
      isError: false,
      result: { content: [{ type: "text", text: "written" }] },
    };

    handleToolExecutionEnd(ctx, evt);

    expect(onToolResult).toHaveBeenCalledTimes(1);
    const call = onToolResult.mock.calls[0][0];
    expect(call.text).toMatch(/write completed successfully\.$/);
  });
});
