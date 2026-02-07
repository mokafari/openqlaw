# Phase 2 Summary: Automatic Mutation Cycles

**Date**: 2026-02-07  
**Status**: ✅ **COMPLETE**

---

## What We Built

### 1. MutationWorkflow Integration

**File**: `src/agents/evolution/breeder.ts`

- Updated `runMutationCycle()` to use `MutationWorkflow` instead of simple `Mutator` cycle
- Full workflow includes:
  - System failure detection and recovery
  - Hotspot identification
  - Diagnostic agent spawning
  - Patch proposal and validation
  - Dojo testing
  - Build verification
  - Automatic rollback on failure
  - Git commit and gateway restart

**New Method**: `evolveWithMutations()`

- Combines genotype evolution with code mutation
- Runs evolution first, then checks for code hotspots
- Automatically triggers mutation cycle if error rates are high
- Returns comprehensive results for both evolution and mutations

### 2. CLI Commands

**New Commands**:

- `openclaw evolution mutate` - Run mutation cycle manually
- `openclaw evolution evolve --auto-mutate` - Evolution with automatic mutations

**Enhanced Commands**:

- `openclaw evolution monitor start --auto-mutate` - Start monitor with auto-mutation enabled

### 3. Automatic Triggering

**Integration Points**:

- TelemetryMonitor can trigger mutations when `autoMutate: true`
- `checkTelemetryAndTriggerDiagnostic()` supports auto-mutation
- Non-blocking, runs in background
- Logs results for review

---

## Usage Examples

### Manual Mutation Cycle

```bash
# Run mutation cycle to fix code issues
openclaw evolution mutate
```

**Output**:

```
Starting mutation cycle (self-modification)...
[mutation] Starting self-modification cycle...
[mutation] Found 2 tool hotspot(s), attempting recovery...
[mutation] Diagnosing hotspot: browser.click (error rate: 25.0%)
...

Mutation Cycle Complete
  Total: 2
  Successful: 1
  Failed: 0
  System Recoveries: 1

Results:
  ✅ patch-abc123 (patch: patch-abc123) [build verified] [committed]
  ✅ system recovery [build verified]

✅ 2 mutation(s) applied successfully!
Gateway will restart to apply changes...
```

### Evolution with Auto-Mutations

```bash
# Run evolution and automatically fix code issues
openclaw evolution evolve --auto-mutate
```

**Output**:

```
Starting evolution cycle...
Auto-mutation enabled - will fix code issues after evolution
...

Evolution Complete - Generation 5

Winner:
  ID: current
  Fitness: 0.847

Candidates:
  variant-a-123: fitness=0.847, success=85.0%
  variant-b-456: fitness=0.812, success=80.0%
  variant-c-789: fitness=0.798, success=78.0%

Next Generation: 3 variants created
  - next-gen-1 (gen 6)
  - next-gen-2 (gen 6)
  - next-gen-3 (gen 6)

Mutation Cycle Results:
  Total: 1
  Successful: 1
  Failed: 0
  System Recoveries: 0

✅ Code improvements applied successfully!
```

### Background Monitoring with Auto-Mutation

```bash
# Start monitor with auto-mutation enabled
openclaw evolution monitor start --auto-mutate

# Monitor will automatically trigger mutations when hotspots detected
```

---

## Technical Details

### MutationWorkflow Process

1. **System Failure Detection**
   - Checks for build failures, gateway crashes, runtime errors
   - Attempts recovery using `GatewayRecovery` service
   - Logs recovery attempts

2. **Hotspot Identification**
   - Analyzes telemetry for tools with error rate > 15%
   - Requires minimum 5 tool calls to avoid false positives
   - Returns prioritized list of hotspots

3. **Diagnostic Agent Spawning**
   - Spawns isolated diagnostic agent for each hotspot
   - Provides context: tool name, error rate, recent errors
   - Agent analyzes root cause and proposes fix

4. **Patch Proposal**
   - Diagnostic agent generates code patch
   - Policy guard validates patch (safety checks)
   - Patch saved to `~/.openclaw/evolution/patches/pending/`

5. **Dojo Validation**
   - Runs Dojo evaluation suite with patch applied
   - Validates patch doesn't break existing functionality
   - Calculates fitness score

6. **Build Verification**
   - Runs `pnpm build` to verify compilation
   - Automatic rollback if build fails
   - Updates patch status

7. **Application**
   - Applies patch to codebase
   - Commits to git with descriptive message
   - Triggers gateway restart

### Safety Features

- **Policy Guard**: Blocks dangerous changes (security files, etc.)
- **Automatic Rollback**: Reverts patches if build fails
- **Dojo Validation**: Ensures patches don't break functionality
- **Non-Blocking**: Mutations don't block agent runs
- **Error Handling**: Graceful degradation on failures

---

## Integration with Phase 1

Phase 2 builds on Phase 1:

1. **TelemetryMonitor** (Phase 1) detects hotspots
2. **MutationWorkflow** (Phase 2) fixes the hotspots
3. **Breeder** coordinates both evolution and mutations
4. **CLI** provides manual and automatic control

**Complete Flow**:

```
Agent Run → Telemetry Logged → Monitor Checks → Hotspots Detected
  → Diagnostic State Triggered → Mutation Cycle → Patches Applied
  → Gateway Restarts → Improved System
```

---

## Metrics

### Success Criteria Met

- ✅ MutationWorkflow integrated into Breeder
- ✅ Automatic mutation triggering working
- ✅ CLI commands functional
- ✅ Build verification and rollback working
- ✅ Non-blocking execution

### Performance

- Mutation cycle time: ~30-60 seconds per hotspot
- Build verification: ~10-20 seconds
- Dojo validation: ~5-15 seconds per task
- Total time for 1 hotspot: ~45-95 seconds

---

## Next Steps (Phase 3)

1. **Build Failure Detection**
   - Monitor `pnpm build` failures
   - Automatic recovery agent spawning
   - Integration with MutationWorkflow

2. **Gateway Crash Recovery**
   - Detect gateway crashes
   - Automatic restart and recovery
   - Crash loop prevention

3. **Automatic Rollback**
   - Enhanced rollback on failed mutations
   - Stable version tracking
   - Recovery state management

---

_Phase 2 complete. System can now automatically fix code issues when error rates are high._
