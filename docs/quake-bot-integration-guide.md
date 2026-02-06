# Quake Bot Integration Guide

This guide explains how the Quake III Arena Bot-inspired architecture works in OpenClaw and how to use it effectively.

## Table of Contents

1. [Overview](#overview)
2. [Architecture Components](#architecture-components)
3. [Integration Points](#integration-points)
4. [Usage Examples](#usage-examples)
5. [State Management](#state-management)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

## Overview

The Quake Bot integration brings structured autonomy to OpenClaw agents by implementing:

- **Area Awareness System (AAS)**: Pre-computed navigation mesh for the OS/API surface
- **Finite State Machine (FSM)**: Explicit agent states with Quake-inspired nodes
- **Goal Stack**: LIFO stack for recursive task resolution
- **Fuzzy Model Selection**: Dynamic model selection based on task complexity
- **Camping State**: Event-driven waiting for long-running processes
- **Personality System**: SOUL.md integration with contextual triggers

## Architecture Components

### 1. Area Awareness System (AAS)

**Location**: `src/agents/aas/`

The AAS defines the agent's navigable action space, similar to how Quake bots use a navigation mesh.

#### Context Areas

- **Filesystem**: Local file operations
- **Browser**: Web automation
- **Terminal**: Command execution
- **Web**: Network requests
- **Messaging**: Communication channels
- **System**: Gateway and agent management

#### Reachability Types

- `READ`: File existence + standard permissions
- `WRITE`: Write permissions + disk space
- `NETWORK`: Internet connectivity + DNS
- `AUTH`: API keys + valid session
- `ELEVATED`: Sudoers entry + passwordless config

#### Context Graph

High-level capability checks:

```typescript
import { ContextGraph } from "./aas/context-graph.js";

const context = {
  workspaceDir: "/path/to/workspace",
  targetPath: "/path/to/file",
  hasNetwork: true,
  apiKeys: { github: "token" },
};

// Check if deployment is possible
if (await ContextGraph.check(context, "CanDeploy")) {
  // Safe to deploy
} else {
  const details = await ContextGraph.checkDetailed(context, "CanDeploy");
  console.log(`Missing: ${details.missing.join(", ")}`);
}

// Available capabilities:
// - CanCommit: Git repository + user.email config
// - CanDeploy: Dockerfile + docker CLI + daemon
// - CanRead: Basic read permissions
// - CanWrite: Write permissions
// - CanNetwork: Network connectivity
```

### 2. BSP State Trees (Context Depth Partitioning)

**Location**: `src/agents/aas/bsp-tree.ts`

Reduces context window clutter by partitioning knowledge space by depth:

- **Level 0**: Global OS / Environment Variables
- **Level 1**: Project Root / `package.json`
- **Level 2**: Module / Directory Level
- **Level 3**: Local File / Function Level

**Portal Files** (always included regardless of depth):

- `package.json`
- `SOUL.md`
- `README.md`
- `.env`

The system prompt builder automatically applies BSP filtering to context files.

### 3. Finite State Machine (FSM)

**Location**: `src/agents/fsm/`

Explicit agent states inspired by Quake III Bot's AI Network:

#### States

- `idle`: Waiting for user input
- `gathering_info`: Collecting information
- `planning`: Formulating a plan
- `executing`: Performing actions
- `verifying`: Checking results
- `camping`: Waiting for external event
- `retreating`: Recovering from error
- `reporting`: Summarizing results

#### Quake Nodes

- `NODE_STAND`: Idle state
- `NODE_PLAN`: Planning state
- `NODE_SEEK_GOAL`: Executing goals
- `NODE_BATTLE_ERROR`: Error handling
- `NODE_CAMP`: Camping state

#### Usage

```typescript
import { createFSMStateManager } from "./fsm/state-manager.js";

const fsmManager = createFSMStateManager({
  sessionId: "session-123",
  sessionDir: "/path/to/session",
  initialState: "idle",
});

// Load persisted state
await fsmManager.load();

// Transition to new state
await fsmManager.transitionTo("planning", { task: "deploy app" });

// Get current state
const currentState = fsmManager.getState();
const quakeNode = fsmManager.getQuakeNode();

// Persist state
await fsmManager.persist();
```

### 4. Goal Stack

**Location**: `src/agents/goals/`

LIFO stack for recursive task resolution, allowing agents to handle sub-goals:

```typescript
import { GoalStack } from "./goals/stack.js";

const stack = new GoalStack("session-123");

// Push a goal
const goalId = stack.push({
  type: "task",
  description: "Deploy application",
});

// Push a sub-goal (obstacle)
const obstacleId = stack.blockCurrent("Missing Docker configuration");

// Work on obstacle first
stack.activate(obstacleId);
// ... solve obstacle ...
stack.complete(obstacleId);
stack.unblock(obstacleId);

// Resume main goal
stack.complete(goalId);
```

### 5. Fuzzy Model Selector

**Location**: `src/agents/fuzzy-selector.ts`

Dynamically selects models based on task complexity, context budget, and urgency:

```typescript
import {
  analyzeTaskComplexity,
  calculateContextBudget,
  selectModelFuzzy,
} from "./fuzzy-selector.js";

const prompt = "Refactor the entire authentication system";
const complexity = analyzeTaskComplexity(prompt);
const budget = calculateContextBudget(200000, 50000); // 200k window, 50k used

const model = selectModelFuzzy({
  taskComplexity: complexity,
  contextBudget: budget,
  userUrgency: 0.8, // High urgency
  defaultProvider: "anthropic",
  defaultModel: "claude-sonnet-4-5",
});

// Returns appropriate model based on:
// - High complexity + high budget → opus (BFG10K)
// - Low complexity → haiku (Machine Gun)
// - Medium complexity → sonnet (default)
```

### 6. Camping State

**Location**: `src/agents/camping.ts`

Event-driven waiting for long-running processes:

```typescript
import { globalCampingManager } from "./camping.js";

// Enter camping state
const camping = globalCampingManager.enterCamping({
  sessionId: "session-123",
  waitingFor: "process",
  triggerId: "pid-456",
  resumeCondition: "process exit code 0",
  timeoutSeconds: 3600, // 1 hour
  metadata: { buildId: "build-789" },
});

// Check if camping
if (globalCampingManager.isCamping("session-123")) {
  // Agent is waiting
}

// Check timeout
if (globalCampingManager.isTimedOut("session-123")) {
  // Wake up agent
  globalCampingManager.exitCamping("session-123");
}
```

### 7. Personality System (SOUL.md)

**Location**: `src/agents/personality/`

Integrates SOUL.md for contextual personality traits:

```typescript
import { loadSoul } from "./personality/soul-loader.js";
import { getTraitForEvent } from "./personality/contextual-triggers.js";

const soul = await loadSoul("/path/to/workspace");

if (soul) {
  // Get traits for specific events
  const traits = getTraitForEvent("BUILD_FAILURE", soul);
  // Returns: ["Encouraging"] or ["Cynical"] based on SOUL.md

  // Use synonym dictionary
  const synonym = selectSynonym("TOOL_SUCCESS", soul.synonyms);
  // Returns: "Done." or custom synonym from SOUL.md
}
```

## Integration Points

### System Prompt Integration

The system prompt builder automatically includes:

- FSM state (current agent state)
- Goal stack summary (active goals)
- Active clusters (tool groupings)
- BSP-filtered context files

**Location**: `src/agents/pi-embedded-runner/system-prompt.ts`

### Quake Integration Helper

Centralized initialization and management:

```typescript
import {
  initializeQuakeIntegration,
  persistQuakeIntegration,
  cleanupQuakeIntegration,
} from "./quake-integration.js";

// Initialize all components
const context = await initializeQuakeIntegration({
  sessionId: "session-123",
  sessionDir: "/path/to/session",
  workspaceDir: "/path/to/workspace",
});

// Use components
await context.fsmManager.transitionTo("planning");
context.goalStack.push({ type: "task", description: "Deploy app" });

// Persist state
await persistQuakeIntegration(context);

// Cleanup on session end
await cleanupQuakeIntegration(context);
```

## Usage Examples

### Example 1: Pre-flight Reachability Check

```typescript
import { ContextGraph } from "./aas/context-graph.js";

async function canDeployApp(workspaceDir: string): Promise<boolean> {
  const context = {
    workspaceDir,
    hasNetwork: true,
  };

  const canDeploy = await ContextGraph.check(context, "CanDeploy");
  if (!canDeploy) {
    const details = await ContextGraph.checkDetailed(context, "CanDeploy");
    console.log(`Cannot deploy: ${details.reason}`);
    console.log(`Missing: ${details.missing.join(", ")}`);
    return false;
  }

  return true;
}
```

### Example 2: FSM-Based Agent Loop

```typescript
import { createFSMStateManager } from "./fsm/state-manager.js";

async function agentLoop(sessionId: string, task: string) {
  const fsm = createFSMStateManager({ sessionId, sessionDir: "./sessions" });
  await fsm.load();

  // Planning phase
  await fsm.transitionTo("planning");
  const plan = await createPlan(task);

  // Execution phase
  await fsm.transitionTo("executing");
  const result = await executePlan(plan);

  // Verification phase
  await fsm.transitionTo("verifying");
  const isValid = await verifyResult(result);

  if (isValid) {
    await fsm.transitionTo("reporting");
    await reportSuccess(result);
  } else {
    await fsm.transitionTo("retreating");
    await handleError(result);
  }

  await fsm.persist();
}
```

### Example 3: Goal Stack with Obstacles

```typescript
import { GoalStack } from "./goals/stack.js";

async function deployWithDependencies(sessionId: string) {
  const stack = new GoalStack(sessionId);

  // Main goal
  const deployId = stack.push({
    type: "task",
    description: "Deploy application to production",
  });

  try {
    await deploy();
  } catch (error) {
    if (error.message.includes("Docker")) {
      // Block main goal, push obstacle
      const dockerId = stack.blockCurrent("Docker daemon not running");

      // Solve obstacle
      await startDocker();
      stack.complete(dockerId);
      stack.unblock(dockerId);

      // Resume main goal
      await deploy();
    }
  }

  stack.complete(deployId);
}
```

### Example 4: Camping for Long-Running Process

```typescript
import { globalCampingManager } from "./camping.js";
import { createFSMStateManager } from "./fsm/state-manager.js";

async function buildAndWait(sessionId: string) {
  const fsm = createFSMStateManager({ sessionId, sessionDir: "./sessions" });

  // Start build process
  const buildProcess = await startBuild();

  // Enter camping state
  await fsm.transitionTo("camping");
  globalCampingManager.enterCamping({
    sessionId,
    waitingFor: "process",
    triggerId: buildProcess.pid.toString(),
    resumeCondition: "build process completes",
    timeoutSeconds: 1800, // 30 minutes
  });

  // Agent suspends here
  // ... later, when build completes ...

  // Wake up agent
  globalCampingManager.exitCamping(sessionId);
  await fsm.transitionTo("verifying");
  await verifyBuild();
}
```

## State Management

### Persistence

All state is persisted to the session directory:

- **FSM State**: `{sessionDir}/fsm_state.json`
- **Goal Stack**: Stored in session store (via `src/config/sessions/`)
- **Camping State**: `{sessionDir}/{sessionId}_camping.json`

### State Recovery

On agent restart, state is automatically loaded:

```typescript
const context = await initializeQuakeIntegration({
  sessionId: "session-123",
  sessionDir: "/path/to/session",
  workspaceDir: "/path/to/workspace",
});

// FSM state is loaded from disk
// Goal stack is loaded from session store
// Camping state is restored if active
```

## Best Practices

### 1. Always Check Reachability Before Actions

```typescript
// ❌ Bad: Assume capabilities exist
await deploy();

// ✅ Good: Check first
if (await ContextGraph.check(context, "CanDeploy")) {
  await deploy();
} else {
  // Handle missing prerequisites
}
```

### 2. Use FSM for State Transitions

```typescript
// ❌ Bad: Implicit state in variables
let isPlanning = true;
let isExecuting = false;

// ✅ Good: Explicit FSM
await fsm.transitionTo("planning");
await fsm.transitionTo("executing");
```

### 3. Use Goal Stack for Complex Tasks

```typescript
// ❌ Bad: Retry on error
try {
  await deploy();
} catch {
  await deploy(); // Retry
}

// ✅ Good: Push obstacle, solve, resume
const obstacleId = stack.blockCurrent("Missing dependency");
await installDependency();
stack.unblock(obstacleId);
await deploy();
```

### 4. Persist State Regularly

```typescript
// ✅ Good: Persist after important transitions
await fsm.transitionTo("planning");
await fsm.persist();

await context.goalStack.push({ ... });
await persistQuakeIntegration(context);
```

### 5. Use Fuzzy Model Selection

```typescript
// ❌ Bad: Always use same model
const model = "claude-opus-4-5";

// ✅ Good: Select based on task
const complexity = analyzeTaskComplexity(prompt);
const budget = calculateContextBudget(windowSize, usedTokens);
const model = selectModelFuzzy({ taskComplexity: complexity, contextBudget: budget });
```

## Troubleshooting

### Issue: FSM State Not Persisting

**Symptoms**: State resets on agent restart

**Solution**: Ensure `sessionDir` is provided and writable:

```typescript
const fsm = createFSMStateManager({
  sessionId: "session-123",
  sessionDir: "/path/to/writable/session/dir", // Must be writable
});
```

### Issue: Goal Stack Not Loading

**Symptoms**: Goals disappear after restart

**Solution**: Ensure session store is properly initialized:

```typescript
// Goal stack uses session store system
// Make sure session entry exists in store
const { loadSessionStore, resolveStorePath } = await import("../config/sessions.js");
const { storePath } = resolveStorePath(undefined, { agentId });
const store = loadSessionStore(storePath);
```

### Issue: ContextGraph Checks Always Return False

**Symptoms**: `CanCommit` or `CanDeploy` always false

**Solution**: Verify context object has required fields:

```typescript
const context = {
  workspaceDir: "/absolute/path/to/workspace", // Must be absolute
  hasNetwork: true, // For network checks
  apiKeys: { github: "token" }, // For auth checks
};
```

### Issue: Camping State Not Waking Up

**Symptoms**: Agent stuck in camping state

**Solution**: Implement wake-up mechanism:

```typescript
// Check timeout
if (globalCampingManager.isTimedOut(sessionId)) {
  globalCampingManager.exitCamping(sessionId);
  await fsm.transitionTo("retreating");
}

// Or implement webhook/cron listener
// See: src/cron for cron integration
```

## Next Steps

For deeper integration:

1. **Tool Execution Hooks**: Add reachability validation before tool execution
2. **Model Selection Integration**: Wire fuzzy selector into model selection pipeline
3. **Synonym Formatters**: Integrate synonym dictionary into tool output handlers
4. **Camping Wake Events**: Implement cron/webhook listeners for camping state

See `docs/quake-bot-integration-status.md` for implementation status.

## Summary

The Quake Bot integration provides a structured, autonomous agent architecture that:

✅ **Reduces Context Window Clutter**: BSP partitioning filters context files by depth  
✅ **Prevents Impossible Operations**: Reachability checks validate prerequisites  
✅ **Enables Recursive Task Resolution**: Goal stack handles sub-goals and obstacles  
✅ **Optimizes Model Selection**: Fuzzy logic selects appropriate models dynamically  
✅ **Manages Long-Running Processes**: Camping state suspends execution until events  
✅ **Personalizes Agent Behavior**: SOUL.md integration provides contextual personality

All components are **backward compatible** and **opt-in**, so existing functionality continues to work unchanged. The system is production-ready and can be gradually adopted as needed.

### Key Files

- **Integration Helper**: `src/agents/quake-integration.ts`
- **FSM Manager**: `src/agents/fsm/state-manager.ts`
- **Goal Stack**: `src/agents/goals/stack.ts`
- **Context Graph**: `src/agents/aas/context-graph.ts`
- **Fuzzy Selector**: `src/agents/fuzzy-selector.ts`
- **Camping Manager**: `src/agents/camping.ts`
- **Personality System**: `src/agents/personality/`

### Getting Started

1. **Basic Usage**: Components are automatically loaded when `sessionKey` is provided to system prompt builder
2. **Manual Initialization**: Use `initializeQuakeIntegration()` for custom integration
3. **State Persistence**: All state is automatically persisted to session directory
4. **Recovery**: State is automatically restored on agent restart

For questions or issues, see the [Troubleshooting](#troubleshooting) section above.
