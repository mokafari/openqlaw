# Evolution System Integration Guide

This document explains the self-evolution system integration in OpenClaw.

## Current Status

- ✅ Core evolution system implemented
- ✅ CLI commands available
- ✅ **Runtime integration complete**
  - Telemetry logging integrated in `src/agents/pi-embedded-runner/run.ts`
  - Genotype application integrated in all system prompt builders
- ✅ All integrations are non-blocking and fail gracefully

## Integration Points

### 1. Telemetry Logging

**Location**: `src/agents/pi-embedded-runner/run.ts` (line ~664)

Automatically logs session stats after each agent run:

- Token usage (input, output, cache read/write)
- Tool call count
- Success/failure status
- Duration
- Generation and genotype ID

The integration is non-blocking and won't fail agent runs if telemetry logging fails.

### 2. System Prompt Application

**Locations**:

- `src/agents/pi-embedded-runner/system-prompt.ts` (embedded runner)
- `src/agents/cli-runner/helpers.ts` (CLI runner)
- `src/auto-reply/reply/commands-context-report.ts` (context reports)

Automatically applies current genotype modifications to system prompts:

- Tone adjustments (concise/explanatory/balanced)
- Planning depth emphasis
- Tool usage guidance
- Chain-of-thought preferences

The integration falls back gracefully if no genotype exists or if the evolution module is unavailable.

## Alternative Integration Methods

### Hook Integration (Limited)

The `evolutionTelemetryHook` can be registered as an `agent_end` hook, but it has limited access to metadata (no token usage, limited tool call info). The direct integration is preferred.

```typescript
import { evolutionTelemetryHook } from "./agents/evolution/hooks.js";

// In plugin registration
api.on("agent_end", evolutionTelemetryHook);
```

## Testing

1. **Check current genotype**: `openclaw evolution status`
2. **Run evaluation suite**: `openclaw evolution dojo`
3. **Run evolution cycle**: `openclaw evolution evolve`
4. **View statistics**: `openclaw evolution stats`
5. **View history**: `openclaw evolution history`

## Safety Features

- ✅ Telemetry logging is non-blocking and won't fail agent runs
- ✅ Genotype application falls back gracefully if no genotype exists
- ✅ Evolution cycles are manual (via CLI) to prevent unwanted changes
- ✅ All integrations use try/catch to handle module loading failures
- ✅ No performance impact when evolution module is unavailable

## How It Works

1. **During Agent Runs**:
   - System prompt is enhanced with genotype modifications (if available)
   - Agent executes normally
   - After completion, telemetry is logged automatically

2. **Evolution Cycle**:
   - Run `openclaw evolution evolve` to create variants
   - Variants are tested (manually or via Dojo)
   - Winner is selected based on fitness scores
   - Next generation is created via interbreeding and mutation

3. **Fitness Calculation**:
   - Success rate (40% weight)
   - Efficiency - token usage and tool calls (30% weight)
   - User satisfaction (30% weight)

## Next Steps

The system is fully integrated and ready to use. To start evolving:

1. Run some agent sessions to collect baseline telemetry
2. Run `openclaw evolution dojo` to evaluate current genotype
3. Run `openclaw evolution evolve` to create and test variants
4. Monitor `openclaw evolution stats` to track improvements
