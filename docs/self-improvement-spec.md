# Self-Improvement Specification for OpenClaw

This document defines the architecture and integration strategy for enabling OpenClaw agents to improve their own code, fix bugs, and optimize their behavior over time through a **Guided Self-Evolution** loop.

## 1. Core Architecture

The system operates on a cycle: **Observe -> Orient -> Decide -> Act**.

### 1.1 Components

1.  **Telemetry Hook (`RunStats`)**:
    - Embedded in `src/agents/pi-embedded-runner.ts`.
    - Captures metrics per session: `success_rate`, `token_usage`, `tool_error_rate`, `user_sentiment` (approximate).
    - Logs to `~/.openclaw/evolution/stats.jsonl`.

2.  **Evolution Engine ("The Breeder")**:
    - A background process (or cron job) that analyzes `stats.jsonl`.
    - Identifies underperforming "Genotypes" (configurations) and successful ones.
    - Decides when to trigger a "Mutation" (e.g., after 10 sessions with < 50% success).

3.  **Genotype Store**:
    - A JSON file (`config/genotype.json`) defining the agent's mutable parameters.
    - Replaces hardcoded constants in `src/agents/defaults.ts` and `src/agents/system-prompt.ts`.

4.  **The Dojo (Evaluation Harness)**:
    - A suite of deterministic tasks (e.g., "Fix this broken regex", "Refactor this function") used to validate mutations before they go live.

---

## 2. The Genotype Structure

We must move away from static constants. The `Genotype` interface defines what can evolve.

```typescript
// src/agents/evolution/types.ts

export interface AgentGenotype {
  generation: number;
  id: string;
  parents?: string[];

  // Linguistic DNA (System Prompt tweaks)
  traits: {
    verbosity: number; // 0.0 (Silent) to 1.0 (Verbose) -> affects prompt instructions
    planning_depth: "shallow" | "normal" | "deep";
    tool_eagerness: number; // Threshold for using tools vs answering directly
    cautiousness: number; // Weight for "Read before Write" instructions
  };

  // numeric DNA (Model Config)
  config: {
    temperature: number;
    default_model: string; // Evolves based on task success vs cost
    context_window_limit: number;
  };
}
```

---

## 3. Integration Plan

### 3.1 Telemetry Integration

Modify `runEmbeddedAttempt` in `src/agents/pi-embedded-runner/run/attempt.ts` to return a `RunStats` object.

```typescript
// Proposed Hook in runEmbeddedAttempt
const stats: RunStats = {
  tokens_in: usage.prompt_tokens,
  tokens_out: usage.completion_tokens,
  tool_calls: attempt.toolMetas.length,
  errors: attempt.toolMetas.filter((t) => t.isError).length,
  // Sentiment analysis could be a simple keyword match on the LAST user message
  user_sentiment: analyzeSentiment(lastUserMessage),
};
await logRunStats(stats, currentGenotype.id);
```

### 3.2 Dynamic System Prompt

Refactor `buildAgentSystemPrompt` in `src/agents/system-prompt.ts` to accept `genotype: AgentGenotype`.

- **Logic**:
  - If `genotype.traits.cautiousness > 0.8`: Inject "ALWAYS read a file before writing to it. Verify existence."
  - If `genotype.traits.verbosity < 0.2`: Inject "Be extremely concise. No preamble."

### 3.3 The Mutator (Self-Correction)

This is the most advanced component. It allows the agent to modify its own source code to fix recurring bugs.

- **Trigger**: High `tool_error_rate` on a specific tool (e.g., `apply_patch`).
- **Action**: The Breeder spawns a specialized "Engineer Agent" with the task:
  - "Analyze `stats.jsonl` failures for `apply_patch`."
  - "Read `src/agents/tools/apply-patch.ts`."
  - "Create a fix/optimization."
  - "Run `tests/dojo/patch-test.ts`."
  - "If pass, create PR/Commit."

---

## 4. Safety & Boundaries

To prevent "devolution" (agent breaking itself), we enforce:

1.  **The Dojo Gate**: No mutation is deployed without passing the standard regression suite.
2.  **Sandbox**: The Mutator agent runs in a strict sandbox with access only to the repo source code, not the running production environment variables (except where necessary).
3.  **Rollback**: The `genotype.json` is versioned. If `Generation N` performance drops by > 10%, automatically revert to `Generation N-1`.

---

## 5. Implementation Roadmap

1.  **Phase 1: Parameterization**
    - Create `Genotype` interface.
    - Refactor `system-prompt.ts` to use it.
    - Create default `genotype.json`.

2.  **Phase 2: Telemetry**
    - Implement `RunStats` logging.
    - Create a simple CLI tool `openclaw stats` to view performance.

3.  **Phase 3: The Breeder Loop**
    - Implement the offline evolution script that generates new genotypes.
    - Implement the "Dojo" test runner.

4.  **Phase 4: Self-Patching**
    - Enable the agent to read/write its own `src/` files under strict supervision.
