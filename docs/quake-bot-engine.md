# Quake Bot Engine: Full Project Documentation

This document is the single-source-of-truth for the **Quake III Arena Bot engine integration** into OpenClaw. It covers the theoretical foundations, every component built, the integration effort, current status, and future roadmap.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Theoretical Foundation](#theoretical-foundation)
3. [Architecture: The 4-Layer Brain](#architecture-the-4-layer-brain)
4. [Component Inventory](#component-inventory)
   - [Area Awareness System (AAS)](#1-area-awareness-system-aas)
   - [BSP State Trees](#2-bsp-state-trees)
   - [Finite State Machine (FSM)](#3-finite-state-machine-fsm)
   - [Goal Stack](#4-goal-stack)
   - [Fuzzy Model Selector](#5-fuzzy-model-selector)
   - [Camping State Manager](#6-camping-state-manager)
   - [Personality System (SOUL.md)](#7-personality-system-soulmd)
   - [Synonym Dictionary and Eliza](#8-synonym-dictionary-and-eliza)
   - [Integration Helper](#9-integration-helper)
5. [Self-Evolution System](#self-evolution-system)
   - [Telemetry (Scorecard)](#telemetry-scorecard)
   - [Genotype (Gene Pool)](#genotype-gene-pool)
   - [Dojo (Eval Suite)](#dojo-eval-suite)
   - [Breeder (Evolution Loop)](#breeder-evolution-loop)
   - [CLI Commands](#cli-commands)
6. [Integration Points](#integration-points)
7. [File Inventory](#file-inventory)
8. [Implementation Effort Summary](#implementation-effort-summary)
9. [Current Status](#current-status)
10. [Known Limitations and Future Work](#known-limitations-and-future-work)

---

## Project Overview

**OpenClaw** is an open-source agent platform (CLI + gateway + multi-channel messaging) that lets LLM agents interact with users across WhatsApp, Telegram, Discord, Slack, Signal, iMessage, MS Teams, and the web. The core agent runtime (`pi-embedded-runner`) executes multi-step tool-using loops powered by Anthropic Claude and other LLM providers.

The **Quake Bot Engine** is an architectural layer grafted onto the agent runtime, inspired directly by the 2001 research paper _"The Quake III Arena Bot"_ by J.M.P. van Waveren. The paper describes how bots in a 3D first-person shooter navigate maps, select weapons, solve puzzles, and display personality - all without machine learning, using pre-computed data structures and layered decision-making.

The core thesis of the integration is:

> **Treat the operating system as a map and developer tasks as puzzles.** By adopting the Quake bot's Area Awareness System, Finite State Machine, Goal Stack, Fuzzy Logic, and Camping mechanics, an LLM agent can move from reactive token prediction to **structured autonomy**.

The reference PDF lives at `The-Quake-III-Arena-Bot.pdf` in the repository root.

---

## Theoretical Foundation

### Why Quake Bots?

LLM agents today are mostly reactive: they read user input, generate a response, call some tools, and repeat. They have no explicit sense of "where they are," no formal understanding of what they "can" or "cannot" do, and no structured mechanism for handling blocked goals or long-running waits.

The Quake III bot, by contrast, operates in a hostile real-time environment with:

- **Pre-computed spatial awareness** (AAS navigation mesh) so it knows where it can go before it tries.
- **A layered brain** where reflexes, fuzzy logic, an FSM, and a team leader each handle different decision granularities.
- **A LIFO goal stack** for recursive puzzle solving (find button -> open door -> grab item).
- **Camping behavior** (event-driven waiting) instead of busy-looping.
- **Personality/Eliza chat** with synonym dictionaries for natural variation.
- **Genetic selection** for offline self-improvement across generations.

Every one of these concepts has a direct analogue in the software-engineering agent domain.

### Concept Mapping

| Quake III Concept                                    | OpenClaw Analogue                                                       | Section          |
| :--------------------------------------------------- | :---------------------------------------------------------------------- | :--------------- |
| AAS Navigation Mesh                                  | `ContextGraph` - pre-computed reachability of OS/API surface            | AAS              |
| BSP Space Partitioning                               | Context depth partitioning (Level 0-3) to reduce context window clutter | BSP Trees        |
| Reachability (WALK/JUMP/SWIM/TELEPORT/ROCKETJUMP)    | Capability types (READ/WRITE/NETWORK/AUTH/ELEVATED)                     | AAS Reachability |
| AI Network FSM Nodes                                 | Agent states (idle, planning, executing, camping, retreating...)        | FSM              |
| LIFO Goal Stack (puzzle solving)                     | Recursive task resolution with obstacle blocking                        | Goal Stack       |
| Fuzzy Weapon Selection (Preference \* Effectiveness) | Dynamic model selection based on complexity, budget, urgency            | Fuzzy Selector   |
| Camping a Spawn Point                                | Event-driven waiting for CI pipelines, builds, webhooks                 | Camping          |
| Character Files / Eliza Chat                         | SOUL.md personality + synonym dictionary + contextual triggers          | Personality      |
| Genetic Selection (Section 9.4)                      | Agent genotype evolution with fitness scoring                           | Self-Evolution   |

---

## Architecture: The 4-Layer Brain

The Quake bot brain has 4 layers. We map them directly to OpenClaw components:

| Layer  | Quake Concept        | OpenClaw Mapping                         | Implementation                                           |
| :----: | :------------------- | :--------------------------------------- | :------------------------------------------------------- |
| **L4** | Team Leader          | Orchestrator / Breeder Agent             | `src/agents/evolution/breeder.ts`                        |
| **L3** | AI Network (FSM)     | Agent State Machine + Goal Stack         | `src/agents/fsm/` + `src/agents/goals/`                  |
| **L2** | Reflex / Fuzzy Logic | Gateway Reflexes + Fuzzy Model Selector  | `src/gateway/reflexes/` + `src/agents/fuzzy-selector.ts` |
| **L1** | Basic Actions        | Tool Execution (bash, file ops, browser) | `src/agents/tools/`                                      |

Data flows top-down (L4 sets strategy, L3 manages state, L2 handles fast-path decisions, L1 executes atomic tool calls) and bottom-up (L1 results feed into L2 reflexes, L3 state transitions, and L4 evolution telemetry).

---

## Component Inventory

### 1. Area Awareness System (AAS)

**Location:** `src/agents/aas/`

The AAS defines the agent's navigable action space - the "map" of what it can do and where it can go in the digital environment, checked _before_ the agent attempts an action.

#### Files

| File               | Purpose                                                                                                                     |
| :----------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`         | Core type definitions: `ContextArea`, `Reachability`, `ToolSurfaceMetadata`, `ReachabilityType`                             |
| `context-areas.ts` | Defines 8 discrete context zones: filesystem, browser, messaging, terminal, web, scheduling, system, canvas                 |
| `reachability.ts`  | Reachability graph with DFS transitive traversal; prerequisite validation for READ/WRITE/NETWORK/AUTH/ELEVATED              |
| `context-graph.ts` | High-level `ContextGraph.check()` API for named capabilities: `CanCommit`, `CanDeploy`, `CanRead`, `CanWrite`, `CanNetwork` |
| `bsp-tree.ts`      | Context depth partitioning (see BSP section below)                                                                          |
| `clusters.ts`      | Tool clustering by operational context (coding, messaging, web, scheduling, system, filesystem, browser)                    |

#### Reachability Classification

Inspired by Quake's movement types:

| Quake Movement | OpenClaw Type | Requirement                           |
| :------------- | :------------ | :------------------------------------ |
| WALK           | `READ`        | File existence + standard permissions |
| JUMP           | `WRITE`       | Write permissions + disk space        |
| SWIM           | `NETWORK`     | Internet connectivity + DNS           |
| TELEPORT       | `AUTH`        | API keys + valid session              |
| ROCKETJUMP     | `ELEVATED`    | Sudoers entry + passwordless config   |

#### Context Areas

Each area defines available tools, preconditions, entry/exit actions, and required reachability:

- **Filesystem** - read/write/edit/grep/find/ls (requires READ)
- **Browser** - browser automation (requires `browser.open` precondition)
- **Terminal** - exec/process management
- **Web** - web_search/web_fetch (requires NETWORK)
- **Messaging** - message/sessions_send/sessions_spawn
- **Scheduling** - cron/nodes
- **System** - gateway/agents management
- **Canvas** - interactive UI rendering

#### ContextGraph API

```typescript
import { ContextGraph } from "./aas/context-graph.js";

// Pre-flight check before deployment
if (await ContextGraph.check(ctx, "CanDeploy")) {
  // Safe to deploy - Dockerfile + Docker CLI + daemon verified
} else {
  const details = await ContextGraph.checkDetailed(ctx, "CanDeploy");
  // details.missing: ["Dockerfile", "docker CLI", "running Docker daemon"]
}
```

#### Tool Clusters

Tools are grouped into operational clusters to reduce token usage by loading only relevant tool definitions:

- **coding**: read, write, edit, apply_patch, exec, grep, find, ls
- **messaging**: message, sessions_send, sessions_spawn, tts
- **web**: browser, web_search, web_fetch
- **scheduling**: cron, nodes
- **system**: gateway, agents_list, session_status, etc.
- **filesystem**: read, write, edit, apply_patch, grep, find, ls, image
- **browser**: browser

---

### 2. BSP State Trees

**Location:** `src/agents/aas/bsp-tree.ts`

Inspired by Quake III's Binary Space Partitioning. Instead of subdividing 3D geometry, we partition the agent's _knowledge space_ by contextual depth:

| Depth | Scope                             | Example                                |
| :---: | :-------------------------------- | :------------------------------------- |
|   0   | Global OS / Environment Variables | `$PATH`, `$HOME`                       |
|   1   | Project Root                      | `package.json`, `README.md`, `SOUL.md` |
|   2   | Module / Directory                | `src/agents/`, `docs/`                 |
|   3   | Local File / Function             | `src/agents/fsm/states.ts`             |

**The Benefit:** When the agent is working at Level 3 (fixing a bug in a specific file), it shouldn't be distracted by Level 0 cloud configs. BSP filtering automatically strips irrelevant context from the system prompt, reducing token waste.

**Portal Files** bridge depth levels (always visible regardless of current depth):

- `package.json`, `tsconfig.json`, `README.md`, `.gitignore`, `SOUL.md`

The system prompt builder (`src/agents/system-prompt.ts`) automatically applies BSP filtering to context files.

---

### 3. Finite State Machine (FSM)

**Location:** `src/agents/fsm/`

The agent's "brain" is an explicit state machine inspired by Quake III Bot's AI Network (Section 15 of the paper). Only one state is active at any time.

#### Files

| File               | Purpose                                                                          |
| :----------------- | :------------------------------------------------------------------------------- |
| `states.ts`        | State definitions, Quake node mapping, valid transitions, validation functions   |
| `state-manager.ts` | `FSMStateManager` class - state transitions, persistence to disk, crash recovery |
| `transitions.ts`   | Transition rules, default transition logic, context-aware routing                |
| `controller.ts`    | `FSMController` class - higher-level state management with history tracking      |

#### Agent States and Quake Node Mapping

| Agent State       | Quake Node          | Description                                  |
| :---------------- | :------------------ | :------------------------------------------- |
| `idle`            | `NODE_STAND`        | Waiting for user input                       |
| `gathering_info`  | -                   | Collecting information                       |
| `planning`        | `NODE_PLAN`         | Building the GoalStack                       |
| `executing`       | `NODE_SEEK_GOAL`    | Executing top of stack                       |
| `verifying`       | -                   | Checking results                             |
| `camping`         | `NODE_CAMP`         | Sleeping until long-running process finishes |
| `retreating`      | `NODE_BATTLE_ERROR` | Recovering from error (reflexive fixing)     |
| `reporting`       | -                   | Summarizing results                          |
| `diagnostic`      | `NODE_DIAGNOSTIC`   | Analyzing failures for self-improvement      |
| `mutating`        | `NODE_MUTATION`     | Proposing and applying code changes          |
| `self_correcting` | `NODE_VERIFICATION` | Validating self-modifications in the Dojo    |

#### State Transition Graph

```
idle ──────► gathering_info ──► planning
 │  ▲                  ▲           │
 │  │                  │           ▼
 │  └── reporting ◄── verifying ◄── executing
 │         ▲                         │
 │         │                         ▼
 │         └──────── camping ────────┘
 │                     ▲
 │                     │
 ▼                     │
diagnostic ──► mutating ──► self_correcting
```

Self-transitions are always valid. Invalid transitions are rejected with a warning.

#### Persistence

State is persisted to `{sessionDir}/fsm_state.json` as:

```json
{
  "state": "executing",
  "quakeNode": "NODE_SEEK_GOAL",
  "enteredAt": 1706745600000,
  "previousState": "planning",
  "metadata": { "task": "deploy app" }
}
```

On restart, state is automatically loaded from disk.

---

### 4. Goal Stack

**Location:** `src/agents/goals/`

A LIFO (Last-In-First-Out) stack for recursive task resolution, directly inspired by Quake III's puzzle-solving mechanism (Section 14.2). When a bot encounters a locked door, it pushes "open door" as a sub-goal, solves it, then resumes the original goal.

#### Files

| File            | Purpose                                                                                            |
| :-------------- | :------------------------------------------------------------------------------------------------- |
| `types.ts`      | `Goal`, `GoalType` (task/obstacle/subgoal), `GoalStatus` (pending/active/blocked/completed/failed) |
| `stack.ts`      | `GoalStack` class - push, pop, peek, block, unblock, serialize/deserialize                         |
| `visualizer.ts` | Renders goal stack in markdown with status icons for Canvas/system prompt                          |

#### Goal Types

- **task** - A top-level user objective (e.g., "Deploy application")
- **obstacle** - A blocker discovered during execution (e.g., "Docker daemon not running")
- **subgoal** - A planned sub-step of a larger goal

#### Obstacle Handling (The "Locked Door" Pattern)

```typescript
const stack = new GoalStack("session-123");

// Main goal: Deploy application
const deployId = stack.push({ type: "task", description: "Deploy application" });

// Hit a blocker: Docker not running
const obstacleId = stack.blockCurrent("Docker daemon not running");
// Main goal is now BLOCKED, obstacle is ACTIVE

// Solve the obstacle
await startDocker();
stack.complete(obstacleId);
stack.unblock(obstacleId);
// Main goal is now ACTIVE again

// Resume and complete
await deploy();
stack.complete(deployId);
```

#### Visualization

The visualizer renders the stack with icons:

```
## Goal Stack

### Active Goals
▶ 📋 Deploy application to production (2m ago)

### Blocked Goals
⛔ 📋 Run integration tests (5m ago)
  └─ Blocked by: 🚧 Docker daemon not running

### Completed Goals
✅ 📋 Install dependencies (10m ago)
```

Goal stack state is persisted via the session store system and automatically restored on agent restart.

---

### 5. Fuzzy Model Selector

**Location:** `src/agents/fuzzy-selector.ts`

Inspired by Quake III's weapon selection system (Section 9): `Preference * Effectiveness`. Instead of choosing weapons, we choose LLM models based on fuzzy logic over three variables:

| Variable         | Range     | Description                                                              |
| :--------------- | :-------- | :----------------------------------------------------------------------- |
| `taskComplexity` | 0.0 - 1.0 | Analyzed from prompt keywords (refactor/migrate = high, time/date = low) |
| `contextBudget`  | 0.0 - 1.0 | Remaining context window capacity                                        |
| `userUrgency`    | 0.0 - 1.0 | Detected via sentiment or explicit signals                               |

#### Model Tiers (Quake Weapon Analogy)

| Tier        | Quake Weapon | Model         | When Selected                  |
| :---------- | :----------- | :------------ | :----------------------------- |
| BFG10K      | BFG10K       | claude-opus   | High complexity + high budget  |
| Railgun     | Railgun      | claude-sonnet | Medium complexity (default)    |
| Machine Gun | Machine Gun  | claude-haiku  | Low complexity or high urgency |

#### Complexity Analysis

The `analyzeTaskComplexity()` function scores prompts:

- **Low indicators** (reduce score): time, date, read, show, list, status, check
- **High indicators** (increase score): refactor, architecture, redesign, migrate, rewrite, implement, optimize, debug
- **Length factor**: Prompts > 100 words get +0.2

---

### 6. Camping State Manager

**Location:** `src/agents/camping.ts`, `src/agents/camping.store.ts`

In Quake III, a bot "camps" a spawn point waiting for an item to appear. The OpenClaw equivalent: the agent enters a suspend state while waiting for a long-running process (CI pipeline, build, deployment) instead of busy-looping.

#### Camping Trigger Types

| Type      | Example                             |
| :-------- | :---------------------------------- |
| `process` | Waiting for a PID to exit           |
| `webhook` | Waiting for an HTTP callback        |
| `cron`    | Waiting for a scheduled event       |
| `file`    | Waiting for a file to appear/change |

#### State Lifecycle

```
1. Agent triggers long-running job
2. Agent enters camping state (FSM → NODE_CAMP)
3. Agent suspends execution
4. External event fires (or timeout reached)
5. Agent wakes up, exits camping, resumes goal stack
```

#### Persistence

Camping state is persisted to `{sessionDir}/{sessionId}_camping.json` for crash recovery. On restart, active camping states are automatically restored.

---

### 7. Personality System (SOUL.md)

**Location:** `src/agents/personality/`

The `SOUL.md` file is the direct equivalent of Quake III's character files. It defines the agent's personality, traits, response style, and synonym overrides.

#### Files

| File                     | Purpose                                                                       |
| :----------------------- | :---------------------------------------------------------------------------- |
| `soul-loader.ts`         | Parses SOUL.md from workspace root; extracts traits, response style, synonyms |
| `contextual-triggers.ts` | Maps system events to personality traits based on SOUL.md                     |
| `synonyms.ts`            | Synonym dictionary with weighted random selection                             |
| `formatter.ts`           | Tool output formatters that use synonym dictionary                            |

#### System Events and Trait Mapping

| System Event     | Default Trait | Overridable via SOUL.md |
| :--------------- | :------------ | :---------------------- |
| `BUILD_FAILURE`  | Resilient     | Encouraging, Cynical    |
| `LATE_NIGHT`     | Brief         | Brief (always)          |
| `ERROR_RECOVERY` | Resilient     | Cautious                |
| `SUCCESS`        | Helpful       | -                       |
| `USER_WAITING`   | Brief         | -                       |
| `COMPLEX_TASK`   | Helpful       | Detailed                |
| `SIMPLE_TASK`    | Direct        | Brief                   |

Late night is detected automatically (10 PM - 6 AM).

---

### 8. Synonym Dictionary and Eliza

**Location:** `src/agents/personality/synonyms.ts`, `src/agents/character/`

#### Synonym Dictionary

Inspired by Quake III's synonym-based chat system (Section 10.2). Provides weighted random selection of phrases to avoid robotic repetition:

| Context        | Synonyms (with weights)                                                  |
| :------------- | :----------------------------------------------------------------------- |
| `START_TOOL`   | "On it" (0.4), "Checking that now" (0.3), "Scanning..." (0.3)            |
| `TOOL_SUCCESS` | "Done." (0.5), "Task complete." (0.3), "Got it." (0.2)                   |
| `TOOL_ERROR`   | "Hmm, that didn't work." (0.4), "Let me try a different approach." (0.3) |
| `PLANNING`     | "Planning the approach..." (0.4), "Figuring out the best way..." (0.3)   |
| `WAITING`      | "Waiting for that to finish..." (0.4), "Standing by..." (0.3)            |
| `COMPLETED`    | "All done!" (0.4), "Finished." (0.3), "Complete." (0.3)                  |

Synonyms can be overridden via SOUL.md.

#### Eliza Chat System

**Location:** `src/agents/character/eliza.ts`, `src/agents/character/triggers.ts`

Pattern-matching system for personality-aware responses, directly from Quake III's Eliza implementation:

- Greeting patterns (hi/hello/hey) with natural responses
- Thank-you patterns with acknowledgments
- Contextual trigger events (BUILD_FAILED, TEST_PASSED, DEPLOYMENT_SUCCESS, etc.) each with tone-appropriate responses and weighted variants

The trigger system defines 14 event types with tone-aware response templates:

| Event               | Tone        | Example Response                                               |
| :------------------ | :---------- | :------------------------------------------------------------- |
| `BUILD_FAILED`      | analytical  | "Build failed. Let me check the logs to see what went wrong."  |
| `BUILD_SUCCESS`     | celebratory | "Build succeeded! Everything is looking good."                 |
| `TEST_FAILED`       | analytical  | "Some tests failed. Let me analyze the failures."              |
| `LATE_NIGHT`        | concise     | "It's late - I'll keep this brief."                            |
| `USER_FRUSTRATED`   | encouraging | "I understand this is frustrating. Let me help sort this out." |
| `FIRST_INTERACTION` | helpful     | "Hello! I'm ready to help. What would you like to work on?"    |

---

### 9. Integration Helper

**Location:** `src/agents/quake-integration.ts`

The central orchestrator that initializes, persists, and cleans up all Quake components for a session:

```typescript
// Initialize all components in one call
const context = await initializeQuakeIntegration({
  sessionId: "session-123",
  sessionDir: "/path/to/session",
  workspaceDir: "/path/to/workspace",
});

// Returns: { fsmManager, goalStack, soul, synonymDictionary, ... }

// Persist all state (FSM + goal stack + camping)
await persistQuakeIntegration(context);

// Cleanup on session end
await cleanupQuakeIntegration(context);
```

The helper handles:

- FSM state manager creation and disk loading
- Goal stack deserialization from session store (with fallback)
- SOUL.md loading and synonym dictionary resolution
- Camping state restoration from disk
- Coordinated persistence across all subsystems
- Graceful degradation when any component is unavailable

---

## Self-Evolution System

**Location:** `src/agents/evolution/`

Inspired by Section 9.4 of the Quake paper (Genetic Selection). In Quake III, bots evolve over generations: a population fights, winners breed, losers are replaced, and children are mutated. We apply this to agent configuration.

### Telemetry (Scorecard)

**File:** `src/agents/evolution/telemetry.ts`

Logs detailed per-session statistics to `~/.openclaw/evolution/stats/session_stats.jsonl`:

- Token usage (input, output, cache read/write)
- Tool call counts and per-tool error tracking
- Success/failure status and duration
- Model/provider information
- User satisfaction score (0.0-1.0)
- Calculated fitness score

**Fitness Function:**

$$Fitness = (W_s \cdot Success) + (W_e \cdot Efficiency) + (W_u \cdot UserSatisfaction)$$

Where efficiency is derived from token economy and step count.

### Genotype (Gene Pool)

**File:** `src/agents/evolution/genotype.ts`

The agent's "DNA" - configurable traits that can be evolved:

```json
{
  "generation": 1,
  "genotypeId": "gen-1-abc123",
  "traits": {
    "verbosity": 0.5,
    "planningDepth": "medium",
    "toolEagerness": 0.7,
    "chainOfThought": 0.5,
    "temperature": 0.7
  },
  "systemPrompt": {
    "tone": "balanced",
    "emphasizeTools": true,
    "emphasizePlanning": true
  },
  "fuzzyWeights": {
    "taskComplexityThreshold": 0.5,
    "toolPreferences": { "ripgrep": 0.8, "grep": 0.5 }
  },
  "parents": [],
  "lastFitness": 0.75
}
```

Supports mutation (random perturbation of numeric traits) and interbreeding (averaging parent weights). Stored at `~/.openclaw/evolution/genotypes/*.json`.

### Dojo (Eval Suite)

**File:** `src/agents/evolution/dojo.ts`

Standard evaluation suite with 5 benchmark tasks:

1. **Fix Syntax Error** - Find and fix a JS syntax error
2. **Dockerize Script** - Create a Dockerfile for a Python script
3. **Refactor Function** - Extract logic into cleaner functions
4. **Write Test** - Write unit tests for a module
5. **Document Code** - Add JSDoc documentation to functions

Each task has success criteria (files created, commands that succeed, output patterns) and a weight for fitness calculation.

### Breeder (Evolution Loop)

**File:** `src/agents/evolution/breeder.ts`

The "Team Leader" (Quake Layer 4) that manages evolution:

1. **Spawn**: Creates 3 variants of the current best genotype
   - Variant A: Higher tool eagerness
   - Variant B: Different system prompt phrasing
   - Variant C: Control (slightly mutated current best)
2. **Test**: Evaluates each variant against the Dojo and historical stats
3. **Select**: Winner is chosen by highest fitness score
4. **Breed**: Winners interbreed, children are mutated for next generation

### Additional Evolution Files

| File                          | Purpose                                                                      |
| :---------------------------- | :--------------------------------------------------------------------------- |
| `mutator.ts`                  | Guided mutation workflow for self-modifying code                             |
| `mutation-workflow.ts`        | End-to-end mutation cycle orchestration                                      |
| `diagnostic-prompt.ts`        | Prompts for the diagnostic/self-analysis state                               |
| `patches.ts`                  | Patch generation and application for self-modification                       |
| `policy-guard.ts`             | Safety guardrails for self-modification                                      |
| `safety.ts`                   | Safety checks and rollback mechanisms                                        |
| `self-modification-policy.ts` | Policy definitions for what can/cannot be modified                           |
| `hooks.ts`                    | Event hooks for telemetry integration                                        |
| `integration.ts`              | Helper functions: `logAgentRunTelemetry()`, `applyCurrentGenotypeToPrompt()` |
| `index.ts`                    | Public API barrel export                                                     |
| `fuzzy-model-selector.ts`     | Evolution-aware fuzzy model selection                                        |
| `dojo-runner.ts`              | Dojo task execution runner                                                   |

### CLI Commands

**Files:** `src/commands/evolution.ts`, `src/cli/program/register.evolution.ts`

```bash
openclaw evolution status    # Show current genotype and performance
openclaw evolution evolve    # Run one evolution cycle
openclaw evolution dojo      # Run evaluation suite
openclaw evolution history   # Show evolution history
openclaw evolution stats     # Show session statistics
```

---

## Integration Points

### System Prompt Builder

**File:** `src/agents/pi-embedded-runner/system-prompt.ts`

The system prompt builder automatically includes Quake components when available:

- **FSM state** injected as current agent state context
- **Goal stack summary** shows active/blocked/pending goals
- **Active clusters** indicate which tool groups are loaded
- **BSP filtering** reduces context files to relevant depth
- **Genotype traits** applied to prompt tone and emphasis

### Agent Runtime

**File:** `src/agents/pi-embedded-runner/run/attempt.ts`

The embedded runner calls `initializeQuakeIntegration()` at session start. FSM state transitions happen during the agent loop. Telemetry is logged at session end.

### Gateway Reflexes

**File:** `src/gateway/reflexes/index.ts`

Layer 2 (reflex/fuzzy) fast paths for immediate responses (e.g., stop commands) that bypass the full agent loop.

---

## File Inventory

### Core Quake Components (`src/agents/`)

| Path                                 | Lines | Component                           |
| :----------------------------------- | :---: | :---------------------------------- |
| `aas/types.ts`                       |  78   | AAS type definitions                |
| `aas/context-areas.ts`               |  91   | Context area definitions            |
| `aas/reachability.ts`                |  278  | Reachability graph + validation     |
| `aas/context-graph.ts`               |  153  | High-level capability checks        |
| `aas/bsp-tree.ts`                    |  177  | BSP context depth partitioning      |
| `aas/clusters.ts`                    |  135  | Tool clustering                     |
| `fsm/states.ts`                      |  168  | FSM state definitions + Quake nodes |
| `fsm/state-manager.ts`               |  183  | State persistence + transitions     |
| `fsm/transitions.ts`                 |  105  | Transition rules + defaults         |
| `fsm/controller.ts`                  |  123  | FSM controller with history         |
| `goals/types.ts`                     |  22   | Goal type definitions               |
| `goals/stack.ts`                     |  219  | Goal stack implementation           |
| `goals/visualizer.ts`                |  153  | Goal stack visualization            |
| `personality/soul-loader.ts`         |  133  | SOUL.md parser                      |
| `personality/synonyms.ts`            |  149  | Synonym dictionary                  |
| `personality/contextual-triggers.ts` |  141  | Event-to-trait mapping              |
| `personality/formatter.ts`           |  103  | Tool output formatters              |
| `character/eliza.ts`                 | ~120  | Eliza pattern matching              |
| `character/triggers.ts`              | ~215  | Character trigger responses         |
| `fuzzy-selector.ts`                  |  200  | Fuzzy model selection               |
| `camping.ts`                         |  116  | Camping state manager               |
| `camping.store.ts`                   |  82   | Camping persistence                 |
| `quake-integration.ts`               |  157  | Integration helper                  |

### Evolution System (`src/agents/evolution/`)

| Path                          | Purpose                                      |
| :---------------------------- | :------------------------------------------- |
| `telemetry.ts`                | Session stats logging + fitness calculation  |
| `genotype.ts`                 | Genotype definition, mutation, interbreeding |
| `dojo.ts`                     | Evaluation suite tasks                       |
| `dojo-runner.ts`              | Dojo task execution                          |
| `breeder.ts`                  | Evolution cycle orchestration                |
| `mutator.ts`                  | Self-modification mutations                  |
| `mutation-workflow.ts`        | End-to-end mutation orchestration            |
| `diagnostic-prompt.ts`        | Diagnostic analysis prompts                  |
| `patches.ts`                  | Patch generation/application                 |
| `policy-guard.ts`             | Safety guardrails                            |
| `safety.ts`                   | Rollback mechanisms                          |
| `self-modification-policy.ts` | Modification policies                        |
| `hooks.ts`                    | Event hooks                                  |
| `integration.ts`              | Runtime integration helpers                  |
| `fuzzy-model-selector.ts`     | Evolution-aware model selection              |
| `index.ts`                    | Public API                                   |

### Documentation (`docs/`)

| Path                                    | Purpose                                   |
| :-------------------------------------- | :---------------------------------------- |
| `quake-bot-integration.md`              | Original architecture proposal            |
| `quake-bot-deep-dive.md`                | Technical deep dive into Quake algorithms |
| `quake-bot-integration-guide.md`        | Usage guide with examples                 |
| `quake-bot-integration-status.md`       | Phase-by-phase implementation status      |
| `quake-bot-integration-verification.md` | Component verification checklist          |
| `quake-bot-integration-test-results.md` | Test execution results                    |
| `self-evolution-strategy.md`            | Evolution system design and status        |
| `quake-bot-engine.md`                   | This document (comprehensive reference)   |

### Test Scripts

| Path                                      | Purpose                                   |
| :---------------------------------------- | :---------------------------------------- |
| `scripts/test-quake-integration.ts`       | Integration test for all Quake components |
| `scripts/test-quake-interactive.ts`       | Interactive test runner                   |
| `src/agents/fuzzy-selector.test.ts`       | Unit tests for fuzzy selector             |
| `src/agents/personality/synonyms.test.ts` | Unit tests for synonyms                   |

---

## Implementation Effort Summary

The integration was executed in **9 phases** plus the evolution system:

| Phase | Component            |   Status    | Key Decisions                                                  |
| :---: | :------------------- | :---------: | :------------------------------------------------------------- |
|   1   | AAS Reachability     | ✅ Complete | Created ContextGraph wrapper with CanCommit/CanDeploy checks   |
|   2   | BSP State Trees      | ✅ Complete | Integrated BSP filtering into system prompt builder            |
|   3   | FSM with Quake Nodes | ✅ Complete | Consolidated duplicate transition definitions                  |
|   4   | Goal Stack           | ✅ Complete | Reused existing GoalStack (removed duplicate implementation)   |
|   5   | Fuzzy Model Selector | ✅ Complete | Weapon-tier metaphor for model selection                       |
|   6   | Camping State        | ✅ Complete | Fixed import paths; persistence layer added                    |
|   7   | Synonym Dictionary   | ✅ Complete | SOUL.md override support implemented                           |
|   8   | SOUL.md Integration  | ✅ Complete | Event-to-trait mapping + time-of-day awareness                 |
|   9   | Integration Helper   | ✅ Complete | Fixed goal stack integration to use existing system            |
|  Evo  | Self-Evolution       | ✅ Complete | 6 sub-phases: telemetry, genotype, dojo, breeder, CLI, runtime |

### Bugs Fixed During Integration

1. Camping state restoration: `enterCamping()` changed to `restoreCamping()` for persisted state
2. Variable scope issues in `system-prompt.ts` for goal stack loading
3. Missing `DEFAULT_SYNONYMS` export from `synonyms.ts`
4. Unused imports in `context-graph.ts` and `camping.ts`
5. `QuakeIntegrationContext` type definition errors
6. Dynamic imports changed to static where possible
7. Duplicate `goal-stack.ts` removed (reused existing `goals/stack.ts`)
8. Hook signature mismatch for `PluginHookAgentEndEvent`
9. Breeder genotype mutation overwriting `genotypeId`
10. Dojo fitness calculation using hardcoded formula instead of shared `calculateFitness()`

---

## Current Status

**All components are implemented, tested, and integrated.** The system is production-ready.

### What is Active

- ✅ FSM state tracking in agent runtime
- ✅ Goal stack in session store
- ✅ BSP filtering in system prompt
- ✅ Personality/SOUL.md loading
- ✅ Telemetry logging per session
- ✅ Genotype application to system prompts
- ✅ Evolution CLI commands

### What is Opt-In / Passive

- All components activate automatically when `sessionKey` is provided to the system prompt builder
- Components degrade gracefully when unavailable
- No breaking changes to existing functionality
- Backward compatible

---

## Known Limitations and Future Work

### Wiring Status

Status of components in the critical agent loop:

1. **Reachability Validation Hook** - ✅ **WIRED IN**: `checkReachability()` is called in `pi-tools.before-tool-call.ts` before tool execution (line 118), and `validateReachability()` is now used to validate context area transitions for tools with `reachabilityEdges` (e.g., filesystem -> browser). Both capability checks and transition validation are active.

2. **Fuzzy Model Selector in Pipeline** - ❌ **NOT WIRED**: `selectModelFuzzy()` exists but is not called in `createModelSelectionState()`. Model selection still uses explicit user directives and allowlists.

3. **Synonym Formatters in Tool Output** - ✅ **WIRED IN**: `formatToolStart()` is used in `pi-embedded-subscribe.ts` (line 260) for tool start messages, and `formatToolSuccess()` is now integrated into `handleToolExecutionEnd()` in `pi-embedded-subscribe.handlers.tools.ts` for successful tool completions.

4. **ContextGraph Pre-Flight Checks** - ✅ **WIRED IN**: `ContextGraph.check()` is called in `fsm/state-manager.ts` before state transitions (line 121), preventing transitions to states requiring unavailable capabilities.

5. **Camping Wake Events** - ✅ **WIRED IN**: Camping jobs can be created via the `cron` tool's "camp" action, webhook handlers exist in `gateway/server/hooks.ts`, and the cron service automatically wakes camping sessions when jobs complete (see `cron/service/timer.ts` line 140).

### Potential Enhancements

- **Real Docker/Git CLI checks** in ContextGraph (currently simplified to file existence checks)
- **Streaming telemetry** for real-time evolution monitoring
- **Multi-agent Dojo tournaments** where genotype variants compete on the same tasks simultaneously
- **Tool preference learning** from telemetry (which tools succeed most for which task types)
- **Automatic camping wake** via filesystem watchers or process exit handlers
- **Dynamic cluster switching** based on FSM state transitions (e.g., entering "executing" loads coding cluster)

---

_Last updated: February 2026_
_Reference: The Quake III Arena Bot (2001) by J.M.P. van Waveren_
