# Comprehensive Bot Logic Analysis: From User Calls to Sub-Agent Issuance

## Executive Summary

This document provides a comprehensive analysis of how the OpenClaw bot system processes user messages from initial receipt through agent execution and sub-agent spawning. The system follows a multi-layered architecture with clear separation between channel adapters, routing, gateway, agent runtime, and tool execution.

---

## Architecture Overview

```
User Message
    ↓
Channel Adapter (Telegram/Discord/Slack/etc.)
    ↓
Routing Layer (resolveAgentRoute)
    ↓
Gateway (HTTP/WebSocket)
    ↓
Agent Runner (runReplyAgent)
    ↓
Agent Execution (runEmbeddedPiAgent)
    ↓
Tool Execution (sessions_spawn)
    ↓
Sub-Agent Registry & Announcement
```

---

## Phase 1: Message Reception & Channel Handling

### 1.1 Channel-Specific Handlers

Each messaging channel has its own handler that receives raw messages:

**Location**: `src/telegram/bot-handlers.ts`, `src/discord/`, `src/slack/`, etc.

**Key Functions**:

- `registerTelegramHandlers()` - Sets up Telegram bot event listeners
- `handleNextcloudTalkInbound()` - Processes Nextcloud Talk messages
- `processTwitchMessage()` - Handles Twitch chat messages

**Example Flow (Telegram)**:

```typescript
bot.on("message", async (ctx) => {
  // 1. Extract message metadata
  const chatId = msg.chat.id;
  const isGroup = msg.chat.type === "group";

  // 2. Access control checks
  // - Group policy (open/allowlist/disabled)
  // - AllowFrom lists
  // - Mention requirements

  // 3. Route to agent
  const route = resolveAgentRoute({...});

  // 4. Format message envelope
  const body = formatAgentEnvelope({...});

  // 5. Call gateway
  await callGateway({ method: "agent", params: {...} });
});
```

**Key Responsibilities**:

- **Access Control**: Validates sender permissions (allowFrom, groupPolicy, mention gates)
- **Message Formatting**: Wraps raw message in channel-specific envelope
- **Routing**: Calls `resolveAgentRoute()` to determine target agent
- **Gateway Invocation**: Sends formatted message to gateway via `callGateway()`

---

## Phase 2: Routing & Session Resolution

### 2.1 Route Resolution

**Location**: `src/routing/resolve-route.ts`

**Function**: `resolveAgentRoute()`

**Purpose**: Determines which agent should handle a message based on:

- Channel type (telegram, discord, etc.)
- Account ID
- Peer information (DM vs group, peer ID)
- Guild/Team IDs (for Discord/Slack)
- Agent bindings configuration

**Resolution Priority** (in order):

1. **Peer binding** - Exact match on `peer.kind` + `peer.id`
2. **Parent peer binding** - For threads, inherits from parent
3. **Guild binding** - Discord guild-specific
4. **Team binding** - Slack team-specific
5. **Account binding** - Account-specific (non-wildcard)
6. **Channel binding** - Wildcard account (`*`)
7. **Default** - Falls back to default agent

**Output**: `ResolvedAgentRoute` containing:

- `agentId`: Which agent to use
- `sessionKey`: Unique session identifier (e.g., `agent:myagent:telegram:dm:123456`)
- `mainSessionKey`: Main session alias for DM collapse
- `matchedBy`: How the route was matched (for debugging)

**Session Key Format**:

```
agent:<agentId>:<channel>:<peerKind>:<peerId>
```

Examples:

- `agent:myagent:telegram:dm:123456` - DM with user 123456
- `agent:myagent:telegram:group:789012` - Group chat 789012
- `agent:myagent:subagent:uuid-here` - Sub-agent session

---

## Phase 3: Gateway Processing

### 3.1 Gateway Entry Points

**Location**: `src/gateway/server-methods/agent.ts`

**Handler**: `agentHandlers.agent`

**Key Steps**:

1. **Idempotency Check**: Uses `idempotencyKey` to deduplicate requests

   ```typescript
   const cached = context.dedupe.get(`agent:${idem}`);
   if (cached) return cached;
   ```

2. **Attachment Processing**: Parses and validates attachments (images, files)

   ```typescript
   const parsed = await parseMessageWithAttachments(message, attachments);
   ```

3. **Timestamp Injection**: Adds current timestamp to messages (for non-channel messages)

   ```typescript
   message = injectTimestamp(message, timestampOptsFromConfig(cfg));
   ```

4. **Session Resolution**: Loads or creates session entry

   ```typescript
   const { entry, storePath } = loadSessionEntry(sessionKey);
   ```

5. **Queue Resolution**: Determines how to handle the message
   - `steer`: Route to embedded Pi if active
   - `followup`: Queue for later processing
   - `collect`: Collect multiple messages
   - `immediate`: Process immediately

6. **Agent Invocation**: Calls `agentCommand()` or queues via `enqueueFollowupRun()`

---

## Phase 4: Agent Runner & Execution

### 4.1 Agent Runner Entry Point

**Location**: `src/auto-reply/reply/agent-runner.ts`

**Function**: `runReplyAgent()`

**Key Responsibilities**:

1. **Session Management**:
   - Loads session entry from store
   - Creates new session if needed
   - Updates session metadata (updatedAt, lastChannel, etc.)

2. **Queue Mode Handling**:
   - **Steer**: Routes to embedded Pi if active session exists
   - **Followup**: Enqueues message for later processing
   - **Immediate**: Processes immediately

3. **Typing Signals**: Manages typing indicators for channels that support them

4. **Block Streaming**: Handles streaming responses with chunking/coalescing

5. **Tool Execution**: Manages tool calls and their results

6. **Memory Management**: Handles memory flush/compaction when needed

### 4.2 Agent Execution Loop

**Location**: `src/auto-reply/reply/agent-runner-execution.ts`

**Function**: `runAgentTurnWithFallback()`

**Execution Flow**:

```typescript
while (true) {
  try {
    // 1. Run agent with model fallback
    runResult = await runWithModelFallback({
      provider,
      model,
      agentDir,
      // ... config
    });

    // 2. Handle tool calls
    if (runResult.toolCalls?.length > 0) {
      await executeTools(runResult.toolCalls);
      continue; // Loop back for next turn
    }

    // 3. Process final reply
    if (runResult.reply) {
      return { kind: "success", runResult };
    }
  } catch (error) {
    // Handle context overflow, compaction failures, etc.
    if (isContextOverflowError(error)) {
      await resetSessionAfterCompactionFailure();
      continue;
    }
    throw error;
  }
}
```

**Key Features**:

- **Model Fallback**: Automatically falls back to cheaper models on errors
- **Tool Execution**: Executes tools and continues conversation
- **Error Recovery**: Handles context overflow, compaction failures
- **Streaming**: Supports streaming responses with partial updates

---

## Phase 5: Tool Execution & Sub-Agent Spawning

### 5.1 Tool Registration

**Location**: `src/agents/openclaw-tools.ts`

**Function**: `createOpenClawTools()`

**Tool Collection**:

- Session tools (`sessions_spawn`, `sessions_patch`, etc.)
- Message tools (`message_send`, `message_reply`)
- File tools (`file_read`, `file_write`)
- Code tools (`codebase_search`, `grep`)
- And many more...

**Tool Factory Pattern**:
Each tool is created by a factory function that returns:

```typescript
{
  label: string;
  name: string;
  description: string;
  parameters: TypeBox schema;
  execute: async (toolCallId, args) => Promise<ToolResult>;
}
```

### 5.2 Sub-Agent Spawning Tool

**Location**: `src/agents/tools/sessions-spawn-tool.ts`

**Function**: `createSessionsSpawnTool()`

**Tool Name**: `sessions_spawn`

**Parameters**:

- `task` (required): Description of what the sub-agent should do
- `label` (optional): Human-readable label for logs/UI
- `agentId` (optional): Which agent to spawn (must be in allowlist)
- `model` (optional): Override model for sub-agent
- `thinking` (optional): Override thinking level
- `runTimeoutSeconds` (optional): Timeout for sub-agent run
- `cleanup` (optional): "delete" | "keep" (default: "keep")

**Execution Flow**:

```typescript
execute: async (_toolCallId, args) => {
  // 1. Validate requester (cannot spawn from sub-agent)
  if (isSubagentSessionKey(requesterSessionKey)) {
    return { status: "forbidden", error: "..." };
  }

  // 2. Check agent allowlist
  if (targetAgentId !== requesterAgentId) {
    const allowAgents = resolveAgentConfig(...)?.subagents?.allowAgents ?? [];
    if (!isAllowed) {
      return { status: "forbidden", error: "..." };
    }
  }

  // 3. Generate child session key
  const childSessionKey = `agent:${targetAgentId}:subagent:${crypto.randomUUID()}`;

  // 4. Resolve model/thinking from config
  const resolvedModel = modelOverride ??
    targetAgentConfig?.subagents?.model ??
    cfg.agents?.defaults?.subagents?.model;

  // 5. Build sub-agent system prompt
  const childSystemPrompt = buildSubagentSystemPrompt({
    requesterSessionKey,
    requesterOrigin,
    childSessionKey,
    task,
    label,
  });

  // 6. Call gateway to start sub-agent
  const response = await callGateway({
    method: "agent",
    params: {
      message: task,
      sessionKey: childSessionKey,
      deliver: false,  // Sub-agents don't deliver directly
      lane: AGENT_LANE_SUBAGENT,  // Special lane for sub-agents
      extraSystemPrompt: childSystemPrompt,
      thinking: thinkingOverride,
      timeout: runTimeoutSeconds > 0 ? runTimeoutSeconds : undefined,
      spawnedBy: requesterInternalKey,
    },
  });

  // 7. Register sub-agent run
  registerSubagentRun({
    runId: response.runId,
    childSessionKey,
    requesterSessionKey,
    requesterOrigin,
    task,
    cleanup,
    label,
    runTimeoutSeconds,
  });

  return { status: "accepted", childSessionKey, runId };
}
```

**Key Constraints**:

- Sub-agents **cannot** spawn other sub-agents (prevents nesting)
- Sub-agents run with `deliver: false` (no direct message delivery)
- Sub-agents use special `AGENT_LANE_SUBAGENT` lane (separate queue)
- Sub-agents get restricted tool set (no session tools by default)

---

## Phase 6: Sub-Agent Registry & Lifecycle

### 6.1 Sub-Agent Registry

**Location**: `src/agents/subagent-registry.ts`

**Purpose**: Tracks all active and completed sub-agent runs

**Data Structure**:

```typescript
type SubagentRunRecord = {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  cleanup: "delete" | "keep";
  label?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  archiveAtMs?: number;
  cleanupCompletedAt?: number;
  cleanupHandled?: boolean;
};
```

**Key Functions**:

1. **`registerSubagentRun()`**: Registers a new sub-agent run
   - Creates record in memory map
   - Persists to disk
   - Starts completion listener
   - Sets up archive timer if configured

2. **`waitForSubagentCompletion()`**: Waits for sub-agent to finish
   - Polls gateway for run status
   - Triggers announcement when complete
   - Handles timeouts

3. **`resumeSubagentRun()`**: Resumes tracking after gateway restart
   - Loads from disk on startup
   - Continues waiting for completion
   - Triggers announcement if already complete

**Persistence**: Registry is saved to disk and restored on gateway restart

---

## Phase 7: Sub-Agent Announcement

### 7.1 Announcement Flow

**Location**: `src/agents/subagent-announce.ts`

**Function**: `runSubagentAnnounceFlow()`

**Purpose**: When a sub-agent completes, announce results back to requester

**Flow**:

```typescript
async function runSubagentAnnounceFlow(params) {
  // 1. Wait for sub-agent completion (if needed)
  const wait = await callGateway({
    method: "agent.wait",
    params: { runId: childRunId, timeoutMs: 60000 },
  });

  // 2. Read sub-agent's final reply
  const reply = await readLatestAssistantReply({
    sessionKey: childSessionKey,
  });

  // 3. Build stats line (runtime, tokens, cost)
  const statsLine = await buildSubagentStatsLine({
    sessionKey: childSessionKey,
    startedAt,
    endedAt,
  });

  // 4. Build announcement message
  const triggerMessage = [
    `A background task "${taskLabel}" just ${statusLabel}.`,
    "",
    "Findings:",
    reply || "(no output)",
    "",
    statsLine,
    "",
    "Summarize this naturally for the user...",
  ].join("\n");

  // 5. Queue announcement to requester
  const queued = await maybeQueueSubagentAnnounce({
    requesterSessionKey,
    triggerMessage,
    requesterOrigin,
  });

  // 6. Handle cleanup
  if (cleanup === "delete") {
    await callGateway({
      method: "sessions.delete",
      params: { key: childSessionKey, deleteTranscript: true },
    });
  }
}
```

**Announcement Modes**:

1. **Steer Mode**: Routes to embedded Pi if requester session is active
2. **Queue Mode**: Enqueues announcement for later delivery
3. **Direct Mode**: Sends announcement directly to requester channel

**Key Features**:

- **Stats Reporting**: Includes runtime, token usage, estimated cost
- **Natural Summarization**: Asks main agent to summarize findings naturally
- **Cleanup**: Optionally deletes sub-agent session after announcement
- **Error Handling**: Gracefully handles failures without breaking main flow

---

## Phase 8: System Prompt & Context

### 8.1 Sub-Agent System Prompt

**Location**: `src/agents/subagent-announce.ts`

**Function**: `buildSubagentSystemPrompt()`

**Purpose**: Provides context to sub-agent about its role and constraints

**Key Instructions**:

- You are a **subagent** spawned for a specific task
- **Stay focused** - Do your assigned task, nothing else
- **Complete the task** - Final message will be reported to main agent
- **Don't initiate** - No heartbeats, no proactive actions
- **Be ephemeral** - May be terminated after completion
- **No user conversations** - That's main agent's job
- **No external messages** - Unless explicitly tasked

**Example Prompt**:

```
# Subagent Context

You are a **subagent** spawned by the main agent for a specific task.

## Your Role
- You were created to handle: {task}
- Complete this task. That's your entire purpose.
- You are NOT the main agent. Don't try to be.

## Rules
1. **Stay focused** - Do your assigned task, nothing else
2. **Complete the task** - Your final message will be automatically reported
3. **Don't initiate** - No heartbeats, no proactive actions
4. **Be ephemeral** - You may be terminated after task completion
```

---

## Data Flow Diagram

```
┌─────────────────┐
│  User Message   │
│  (Telegram/etc) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Channel Handler │ ◄─── Access Control (allowFrom, groupPolicy)
│  (bot-handlers) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Route Resolver │ ◄─── Agent Bindings Config
│ (resolve-route) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Gateway      │ ◄─── Idempotency, Session Management
│ (server-methods)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Agent Runner   │ ◄─── Queue Mode (steer/followup/immediate)
│ (agent-runner)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Agent Execution │ ◄─── Model Fallback, Tool Execution
│ (pi-embedded)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Tool: sessions │
│     _spawn      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Sub-Agent Start │ ◄─── New Session Key, System Prompt
│  (gateway.agent)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Sub-Agent Runs  │ ◄─── Isolated Session, Restricted Tools
│  (agent-runner) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Sub-Agent Done  │
│  (registry)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Announcement   │ ◄─── Results + Stats → Requester
│ (subagent-ann)  │
└─────────────────┘
```

---

## Key Configuration Points

### Agent Bindings

**Location**: `~/.openclaw/config.json`

```json
{
  "agents": {
    "bindings": [
      {
        "agentId": "myagent",
        "match": {
          "channel": "telegram",
          "accountId": "default",
          "peer": { "kind": "dm", "id": "123456" }
        }
      }
    ]
  }
}
```

### Sub-Agent Configuration

```json
{
  "agents": {
    "defaults": {
      "subagents": {
        "model": "anthropic/claude-sonnet-4-20250514",
        "thinking": "low",
        "archiveAfterMinutes": 60
      }
    },
    "list": [
      {
        "id": "myagent",
        "subagents": {
          "allowAgents": ["*"], // Allow spawning any agent
          "model": "anthropic/claude-haiku-3-5",
          "thinking": "low"
        }
      }
    ]
  }
}
```

### Session Configuration

```json
{
  "session": {
    "dmScope": "main", // or "per-peer", "per-channel-peer"
    "store": "~/.openclaw/sessions"
  }
}
```

---

## Security & Isolation

### Sub-Agent Isolation

1. **Session Isolation**: Each sub-agent gets unique session key
   - Format: `agent:<agentId>:subagent:<uuid>`
   - Separate session store entry
   - No access to requester's session state

2. **Tool Restrictions**: Sub-agents get restricted tool set
   - **No session tools** by default (configurable via `tools.subagents.tools`)
   - Cannot spawn other sub-agents (prevents nesting)
   - Cannot modify requester's session

3. **Delivery Isolation**: Sub-agents run with `deliver: false`
   - No direct message delivery
   - Results only announced via main agent
   - Prevents sub-agents from sending messages directly

4. **Agent Allowlist**: Sub-agents can only spawn allowed agents
   - Configurable per agent: `subagents.allowAgents`
   - Default: only requester's agent
   - `["*"]` allows any agent

### Access Control

1. **Channel-Level**: Handled in channel handlers
   - `allowFrom`: List of allowed senders
   - `groupPolicy`: How group messages are handled
   - Mention gates: Require @mention in groups

2. **Session-Level**: Handled in gateway
   - `sendPolicy`: Controls message delivery
   - Per-session overrides via `sessions.patch`

---

## Error Handling & Recovery

### Common Error Scenarios

1. **Context Overflow**:
   - Detected: `isContextOverflowError()`
   - Recovery: Auto-compaction or session reset
   - Retry: Continues with compacted session

2. **Compaction Failure**:
   - Detected: `isCompactionFailureError()`
   - Recovery: Session reset (deletes transcript)
   - Retry: Continues with fresh session

3. **Sub-Agent Timeout**:
   - Detected: `agent.wait()` returns `status: "timeout"`
   - Recovery: Announcement with timeout status
   - Cleanup: Proceeds with normal cleanup

4. **Gateway Restart**:
   - Recovery: Registry restored from disk
   - Resume: `resumeSubagentRun()` continues tracking
   - Announcement: Triggers if sub-agent already complete

---

## Performance Considerations

### Sub-Agent Costs

- **Token Usage**: Each sub-agent has its own context
  - Separate input/output token counts
  - Cost tracked per sub-agent
  - Reported in announcement stats

- **Model Selection**: Use cheaper models for sub-agents
  - Default: Inherits requester's model
  - Override: `agents.defaults.subagents.model`
  - Per-agent: `agents.list[].subagents.model`

### Queue Management

- **Lane Separation**: Sub-agents use `AGENT_LANE_SUBAGENT`
  - Separate queue from main agent runs
  - Prevents blocking main agent
  - Parallel execution possible

- **Archive Policy**: Sub-agent sessions archived after N minutes
  - Configurable: `agents.defaults.subagents.archiveAfterMinutes`
  - Default: 60 minutes
  - Cleanup: Deletes session if `cleanup: "delete"`

---

## Debugging & Monitoring

### Log Locations

1. **Gateway Logs**: `/tmp/openclaw-gateway.log`
   - Gateway-level errors
   - Agent invocation logs
   - Sub-agent registration

2. **Session Logs**: `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`
   - Per-turn conversation history
   - Tool calls and results
   - Sub-agent sessions have separate logs

3. **macOS Unified Logs**: `./scripts/clawlog.sh`
   - System-level logs
   - Gateway process logs

### Sub-Agent Inspection

**Slash Commands** (in agent chat):

- `/subagents list` - List all sub-agents for current session
- `/subagents info <id|#>` - Show sub-agent metadata
- `/subagents log <id|#>` - Show sub-agent transcript
- `/subagents stop <id|#|all>` - Stop running sub-agent
- `/subagents send <id|#> <message>` - Send message to sub-agent

### Registry Inspection

**Location**: `~/.openclaw/subagents.json` (persisted registry)

**Structure**:

```json
{
  "runs": {
    "<runId>": {
      "runId": "...",
      "childSessionKey": "agent:myagent:subagent:uuid",
      "requesterSessionKey": "agent:myagent:telegram:dm:123",
      "task": "Research topic X",
      "createdAt": 1234567890,
      "startedAt": 1234567891,
      "endedAt": 1234567900,
      "outcome": { "status": "ok" }
    }
  }
}
```

---

## Summary

The OpenClaw bot system follows a well-architected flow:

1. **Messages arrive** via channel-specific handlers (Telegram, Discord, etc.)
2. **Routing determines** which agent and session should handle the message
3. **Gateway processes** the request with idempotency and session management
4. **Agent runner** executes the agent with queue mode handling
5. **Agent execution** runs with model fallback and tool support
6. **Sub-agents spawn** via `sessions_spawn` tool with isolation
7. **Sub-agents run** in isolated sessions with restricted tools
8. **Results announce** back to requester with stats and cleanup

The system emphasizes:

- **Isolation**: Sub-agents are fully isolated from requester
- **Security**: Access control at multiple layers
- **Reliability**: Error recovery and persistence
- **Performance**: Parallel execution and cost optimization
- **Observability**: Comprehensive logging and inspection tools
