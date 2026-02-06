# Incremental Guided Self-Evolution for OpenClaw

This document outlines a strategy for implementing **Self-Evolution** and **Self-Learning** within the OpenClaw ecosystem, directly inspired by the **Genetic Selection** mechanisms described in Section 9.4 of the _Quake III Arena Bot_ research paper.

## 1. The Core Concept: Genetic Selection (Quake III)

In Quake III, bots do not "learn" in real-time during a match in the traditional sense. Instead, they evolve over generations:

1.  **Population**: A set of 10 bots with identical code but different **Fuzzy Relations** (weights for weapon/item preference).
2.  **The Arena**: Bots fight in duels.
3.  **Ranking**: Bots are ranked by wins/losses.
4.  **Selection**: Winners become "Parents". Losers are replaced.
5.  **Interbreeding**: Parent weights are averaged to create a "Child".
6.  **Mutation**: The Child's weights are slightly randomized to introduce variation.

**Result**: Over time, an optimal set of weights emerges that balances aggression, caution, and resource gathering without human hard-coding.

---

## 2. Adapting for OpenClaw: The "Agent Genotype"

To apply this to OpenClaw, we must define the "DNA" of an agent. Unlike Quake bots which have numeric fuzzy weights, an LLM Agent's genotype is linguistic and configuration-based.

### The Genotype Components

1.  **System Prompt (Linguistic DNA)**:
    - Tone instructions (e.g., "Be concise" vs "Be explanatory").
    - Chain-of-thought structural requirements.
2.  **Model Configuration (Numeric DNA)**:
    - `Temperature` (Creativity vs Determinism).
    - `ContextWindow` limits.
3.  **Fuzzy Decision Weights** (Proposed in `quake-bot-integration.md`):
    - `TaskComplexity` threshold for switching models.
    - `ToolPreference` (e.g., preference for `ripgrep` over `grep`).

---

## 3. The "Arena": Defining Fitness Functions

In Quake, fitness is simple: `FragCount` (Kills). In Software Engineering, fitness is multi-dimensional.

We define a **Fitness Score (0.0 - 1.0)** based on:

1.  **Success Rate ($S$)**: Did the task complete without error? (Exit code 0, no unhandled exceptions).
2.  **Efficiency ($E$)**:
    - **Token Usage**: Fewer tokens = higher score.
    - **Steps**: Fewer tool calls = higher score.
3.  **User Satisfaction ($U$)**: Explicit feedback (Thumbs up/down) or sentiment analysis of user replies ("Great job" vs "That's wrong").

$$ Fitness = (W_s \cdot S) + (W_e \cdot E) + (W_u \cdot U) $$

---

## 4. The Evolutionary Loop (Implementation)

We propose a **Guided Evolution Cycle** that runs effectively "offline" or in the background.

### Step 1: Parameterization

Refactor `src/agents/system-prompt.ts` and `src/agents/defaults.ts` to load values from a `genotype.json` file instead of hardcoded strings/constants.

```json
// genotype.json
{
  "generation": 1,
  "traits": {
    "verbosity": 0.5,
    "planning_depth": "deep",
    "tool_eagerness": 0.8
  }
}
```

### Step 2: The "Breeder" Agent (Supervisor)

A meta-agent (The "Team Leader" from Quake Layer 4) responsible for evolution.

1.  **Spawn**: The Breeder creates 3 variations of the current best agent.
    - _Variant A_: Higher "tool_eagerness".
    - _Variant B_: Different system prompt phrasing.
    - _Variant C_: Control (Current best).
2.  **Test**: Run all 3 against a **Standard Evaluation Set** (e.g., "Fix a syntax error in this file", "Dockerize this script").
3.  **Measure**: Record cost, time, and success.

### Step 3: Interbreeding & Mutation

- **Winner**: Variant A wins.
- **Update**: `genotype.json` is updated with Variant A's parameters.
- **Mutation**: For the next generation, tweak Variant A's `verbosity` by ±0.1.

---

## 5. Continuous "Live" Learning (The Memory Stack)

Quake bots use a **Goal Stack** (Section 14.2) to solve immediate puzzles. We can treat "Session History" as a form of short-term learning that solidifies into long-term knowledge.

**Mechanism: The "Post-Mortem" Commit**
At the end of a session, if the Feedback ($U$) is positive:

1.  The agent summarizes _what worked_ ("Using `ripgrep` with `--no-ignore` found the hidden file").
2.  This insight is committed to a `KNOWLEDGE_BASE.md` or `learned_weights.json`.
3.  Future sessions read this file (Pre-computation/AAS logic) to avoid repeating mistakes.

---

## 6. Implementation Status

### ✅ Phase 1: The Scorecard (Telemetry) - COMPLETE

- **Implementation**: `src/agents/evolution/telemetry.ts`
- Logs detailed stats per run:
  - Total tokens (input, output, cache read/write).
  - Total tool calls.
  - Success/failure status.
  - Duration and model/provider info.
  - User satisfaction (optional).
  - Calculated fitness score.
  - Result: `~/.openclaw/evolution/stats/session_stats.jsonl`.

### ✅ Phase 2: The Gene Pool (Config) - COMPLETE

- **Implementation**: `src/agents/evolution/genotype.ts`
- Genotype system with:
  - Traits (verbosity, planning depth, tool eagerness, chain-of-thought, temperature).
  - System prompt configuration (tone, emphasis flags).
  - Fuzzy decision weights (task complexity threshold, tool preferences).
  - Generation tracking and parent lineage.
  - Mutation and interbreeding functions.
  - Storage: `~/.openclaw/evolution/genotypes/*.json`.

### ✅ Phase 3: The Dojo (Eval Suite) - COMPLETE

- **Implementation**: `src/agents/evolution/dojo.ts`
- Standard evaluation suite with 5 tasks:
  - Fix Syntax Error
  - Dockerize Script
  - Refactor Function
  - Write Test
  - Document Code
- Each task has success criteria and weighted fitness calculation.

### ✅ Phase 4: Evolution Loop (Breeder) - COMPLETE

- **Implementation**: `src/agents/evolution/breeder.ts`
- Breeder agent that:
  - Creates variants of current best genotype.
  - Evaluates genotypes against stats/Dojo.
  - Selects winners based on fitness.
  - Creates next generation via interbreeding and mutation.

### ✅ Phase 5: CLI Integration - COMPLETE

- **Implementation**: `src/commands/evolution.ts`, `src/cli/program/register.evolution.ts`
- CLI commands:
  - `openclaw evolution status` - Show current genotype and performance
  - `openclaw evolution evolve` - Run one evolution cycle
  - `openclaw evolution dojo` - Run evaluation suite
  - `openclaw evolution history` - Show evolution history
  - `openclaw evolution stats` - Show session statistics

### ✅ Phase 6: Runtime Integration - COMPLETE

- **Implementation**:
  - Telemetry logging integrated in `src/agents/pi-embedded-runner/run.ts`
  - Genotype application integrated in:
    - `src/agents/pi-embedded-runner/system-prompt.ts`
    - `src/agents/cli-runner/helpers.ts`
    - `src/auto-reply/reply/commands-context-report.ts`
- **Behavior**: Both integrations are non-blocking and gracefully fall back if evolution module is unavailable.

---

## Usage

### Initial Setup

```bash
# Check current genotype status
openclaw evolution status

# Run Dojo evaluation suite
openclaw evolution dojo

# Run evolution cycle (creates variants, tests, selects winner)
openclaw evolution evolve

# View evolution history
openclaw evolution history

# View session statistics
openclaw evolution stats
```

### Manual Genotype Management

```typescript
import { loadGenotype, saveGenotype, mutateGenotype } from "./agents/evolution/genotype.js";

// Load current genotype
const genotype = await loadGenotype();

// Create a mutation
const mutated = mutateGenotype(genotype, 0.1);

// Save it
await saveGenotype(mutated);
```

### Telemetry Integration

Telemetry can be logged using the integration helper:

```typescript
import { logAgentRunTelemetry } from "./agents/evolution/integration.js";

await logAgentRunTelemetry({
  sessionId: result.meta.agentMeta?.sessionId ?? sessionId,
  sessionKey: sessionKey,
  meta: result.meta,
  agentMeta: result.meta.agentMeta,
  toolMetas: attempt.toolMetas,
});
```

Or via the `agent_end` hook (limited metadata):

```typescript
import { evolutionTelemetryHook } from "./agents/evolution/hooks.js";

api.on("agent_end", evolutionTelemetryHook);
```

### System Prompt Integration

Apply genotype to system prompt:

```typescript
import { applyCurrentGenotypeToPrompt } from "./agents/evolution/integration.js";

const enhancedPrompt = await applyCurrentGenotypeToPrompt(basePrompt);
```

---

## Summary

By treating the Agent Configuration as a **Genotype** and the Development Environment as the **Arena**, OpenClaw can move from static logic to an evolving system that optimizes itself for cost and correctness over time, mirroring the robustness of the Quake III Bot.

**Status**: ✅ **FULLY INTEGRATED** - Core evolution system implemented, tested, and integrated into the agent runtime. Telemetry logging and genotype application are active. See `docs/evolution-integration.md` for details.

## Issues Fixed

1. ✅ **Hook signature mismatch**: Fixed to match actual `PluginHookAgentEndEvent` structure
2. ✅ **Breeder genotype mutation bug**: Fixed overwriting of genotypeId by creating a copy
3. ✅ **Dojo fitness calculation**: Now uses standard `calculateFitness` function instead of hardcoded formula
4. ✅ **Missing integration helpers**: Added `logAgentRunTelemetry` and `applyCurrentGenotypeToPrompt` functions
5. ✅ **Import issues**: Fixed dynamic import in dojo.ts to use static import
