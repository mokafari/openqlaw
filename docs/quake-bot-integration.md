# Quake III Arena Bot Architecture for OpenClaw

This document outlines a strategy to evolve OpenClaw's agentic architecture by adopting principles from the **Quake III Arena Bot (2001)**. The core philosophy is shifting from _reactive processing_ to _pre-computed awareness (AAS)_ and _layered decision making_.

## 1. The Digital AAS (Area Awareness System)

In Quake III, the bot doesn't "look" at geometry every frame; it relies on a pre-computed navigation mesh (AAS) defining where it _can_ go.

### Current State

OpenClaw agents largely "hallucinate" their environment, discovering file paths and permissions reactively via `ls` or `cat`.

### Proposal: The `ContextGraph`

We need a "Digital AAS" that defines the "Reachability" of the OS and API surface.

- **Areas (Nodes)**:
  - `LocalFileSystem`
  - `GitRepository`
  - `DockerDaemon`
  - `DiscordChannel:#dev`
- **Reachability (Edges)**:
  - `CanCommit` (Requires: `.git` folder + `user.email` config).
  - `CanDeploy` (Requires: `Dockerfile` + `docker` CLI + Running Daemon).

**Implementation:**
Create a `src/agents/context-graph.ts`. Before an agent enters the `CODING` state, it checks reachability.

```typescript
// Pseudo-code for Reachability Check
if (ContextGraph.check(ctx, "CanDeploy")) {
  // Safe to propose deployment
} else {
  // Prerequisite missing: Plan a route to "fix docker" first
}
```

## 2. The 4-Layer Brain Architecture

We map the Quake Bot's 4 layers to OpenClaw components.

| Layer  | Quake Concept        | OpenClaw Mapping     | Implementation Plan                                                                                                   |
| :----- | :------------------- | :------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| **L4** | **Team Leader**      | **Orchestrator**     | Enhance `src/agents/subagent-registry.ts` to assign strict roles (e.g., "You are the Linter," "You are the Builder"). |
| **L3** | **AI Network (FSM)** | **Agent State**      | Explicit FSM in `pi-embedded-runner.ts`. States: `PLANNING`, `CODING`, `VERIFYING`, `WAITING`.                        |
| **L2** | **Reflex/Fuzzy**     | **Gateway/Selector** | `model-selection.ts` and `openclaw-gateway-tool.ts`. Fast paths for "Stop" commands or rote tasks.                    |
| **L1** | **Basic Actions**    | **Tool Execution**   | `bash-tools` and `openclaw-tools`. Deterministic atomic operations.                                                   |

## 3. Fuzzy Cognitive Economy (Layer 2)

Quake bots use fuzzy logic (e.g., `LightningGunPreference * AmmoCount`) to choose weapons. OpenClaw should use fuzzy logic to choose _models_ and _strategies_.

### Proposal: `FuzzyModelSelector`

Instead of hardcoding models, weigh them dynamically.

- **Variables**:
  - `TASK_COMPLEXITY`: 0.0 (Time check) to 1.0 (Refactoring kernel).
  - `CONTEXT_BUDGET`: Remaining context window tokens.
  - `USER_URGENCY`: Detected via sentiment analysis.

**Logic**:

```typescript
// src/agents/model-selection.ts
function selectModel(task, context) {
  if (task.complexity > 0.8 && context.budget > 0.5) {
    return "claude-3-opus"; // "BFG10K"
  } else if (task.complexity < 0.2) {
    return "haiku-flash"; // "Machine Gun"
  }
}
```

## 4. Goal Stacks (Layer 3)

Quake bots solve puzzles (e.g., "Find Button T1 to open Door D1") using a LIFO stack.

### Proposal: Explicit Goal Stack in Session

Currently, the agent's plan is hidden in the chat log. We should formalize it.

- **Structure**: `[ "Deploy App", "Fix Build Error", "Install Dependencies" ]`
- **Action**: The agent must explicitly `push` constraints and `pop` solved goals.
- **Visualization**: Render this stack in the TUI (`src/tui`).

## 5. Camping (The "Wait" Mechanic)

A bot "camps" a spawn point waiting for an item. OpenClaw agents currently busy-loop ("Is the build done?").

### Proposal: Event-Driven Camping

- **State**: `STATE_CAMPING`.
- **Mechanism**: Use `src/cron` or a new `WebhookListener`.
- **Flow**:
  1. Agent triggers a long running job (e.g., CI pipeline).
  2. Agent enters `STATE_CAMPING` (suspends execution).
  3. External Webhook (or internal poller) fires.
  4. Agent "wakes up" (Resume Session).

## 6. Soul & Personality (Eliza)

The `SOUL.md` file (`docs/reference/templates/SOUL.md`) is the direct equivalent of Quake's character files.

### Integration

- **Contextual Triggers**: Map system events to "Soul Traits".
  - `Event: BUILD_FAILURE` -> `Trait: Encouraging` or `Trait: Cynical` (depending on `SOUL.md`).
  - `Event: LATE_NIGHT` -> `Trait: Brief`.
- **Chat Synonyms**: Use a synonym dictionary to vary tool output responses ("On it," "Working...", "Deploying now") to avoid robotic repetition.

## Implementation Roadmap

1.  **Phase 1 (Reflexes)**: Implement `FuzzyModelSelector` in `src/agents/model-selection.ts`.
2.  **Phase 2 (AAS)**: Build the `ContextGraph` definitions for common tasks (Git, Docker, Node).
3.  **Phase 3 (Brain)**: Refactor `pi-embedded-runner.ts` to respect an explicit FSM.
4.  **Phase 4 (Soul)**: Wire `SOUL.md` into the `system-prompt.ts` generator dynamically based on events.
