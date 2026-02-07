# AGI Roadmap: Path to Autonomous Self-Improving Agent

**Status**: 🚧 **IN PROGRESS**  
**Last Updated**: 2026-02-07  
**Goal**: Transform OpenClaw from a reactive agent platform into a self-improving AGI system

---

## Vision

> **"The agent that fixes itself, evolves itself, and becomes more capable over time without human intervention."**

This roadmap outlines the path from the current state (manual evolution, reactive error handling) to full AGI (autonomous self-improvement, continuous learning, recursive capability growth).

---

## Current State Assessment

### ✅ What We Have

1. **Quake Bot Engine** - Stable 4-layer brain architecture
   - Goal Stack, FSM, Camping, Fuzzy Selector, AAS
   - All core systems operational

2. **Evolution System** - Genetic selection framework
   - Telemetry logging (automatic)
   - Genotype system (traits, system prompt config)
   - Dojo evaluation suite
   - Breeder agent (creates variants, selects winners)
   - **Status**: Manual execution only

3. **Self-Modification Infrastructure**
   - MutationWorkflow (identify → diagnose → patch → verify)
   - Mutator class (hotspot detection, diagnostic agents)
   - Policy guard (safety restrictions)
   - Patch system (save, apply, revert)
   - **Status**: Manual execution only

4. **FSM States for Self-Improvement**
   - `NODE_DIAGNOSTIC` - Analyzing failures
   - `NODE_MUTATION` - Proposing code changes
   - `NODE_VERIFICATION` - Validating in Dojo
   - **Status**: States exist, but transitions are not automatic

### ❌ What's Missing

1. **Automatic Error Detection & Response**
   - No automatic transition to diagnostic state when tool error rate exceeds threshold
   - No automatic triggering of mutation cycles
   - No build failure detection and auto-recovery

2. **Continuous Evolution Loop**
   - Evolution cycles are manual (CLI only)
   - No background process monitoring telemetry and triggering evolution
   - No automatic mutation cycles based on error patterns

3. **Self-Healing System**
   - Build failure detection exists but not integrated
   - No automatic recovery from gateway crashes
   - No automatic rollback on failed mutations

4. **Recursive Improvement**
   - No mechanism for agents to spawn sub-agents to fix themselves
   - No feedback loop from mutations back to evolution system
   - No capability growth tracking

---

## Implementation Phases

### Phase 1: Automatic Error Detection & Diagnostic Triggers ⚡ (CURRENT)

**Goal**: Automatically detect errors and transition to diagnostic state

**Tasks:**

1. ✅ Create telemetry monitoring service
2. ⏳ Implement automatic FSM transition to `NODE_DIAGNOSTIC` when tool error rate > threshold
3. ⏳ Add error rate monitoring in agent runtime
4. ⏳ Trigger diagnostic agent spawn on threshold breach

**Files to Modify:**

- `src/agents/pi-embedded-runner/run.ts` - Add error rate monitoring
- `src/agents/fsm/state-manager.ts` - Add automatic transitions
- `src/agents/evolution/telemetry-monitor.ts` - New service for monitoring

**Success Criteria:**

- Agent automatically transitions to diagnostic state when tool error rate > 20%
- Diagnostic agent spawns and analyzes failures
- Results feed back into mutation workflow

---

### Phase 2: Automatic Mutation Cycles 🔄

**Goal**: Automatically run mutation cycles when hotspots are detected

**Tasks:**

1. ⏳ Integrate MutationWorkflow into Breeder
2. ⏳ Create automatic mutation trigger based on telemetry
3. ⏳ Add mutation cycle to evolution CLI with auto-mode
4. ⏳ Implement mutation result feedback to evolution system

**Files to Modify:**

- `src/agents/evolution/breeder.ts` - Add `runMutationCycle()` integration
- `src/agents/evolution/mutation-workflow.ts` - Ensure full cycle works
- `src/commands/evolution.ts` - Add auto-mutation mode

**Success Criteria:**

- Mutation cycles run automatically when hotspots detected
- Patches are validated in Dojo before application
- Successful mutations improve fitness scores

---

### Phase 3: Self-Healing System 🛠️

**Goal**: Automatically detect and recover from build failures and crashes

**Tasks:**

1. ⏳ Implement build failure detection (monitor `pnpm build` failures)
2. ⏳ Create GatewayRecovery service for crash detection
3. ⏳ Add automatic rollback on failed mutations
4. ⏳ Implement crash loop detection and prevention

**Files to Create/Modify:**

- `src/agents/evolution/gateway-recovery.ts` - Recovery service
- `src/agents/evolution/build-monitor.ts` - Build failure detection
- `src/gateway/lifecycle.ts` - Crash detection hooks

**Success Criteria:**

- Build failures automatically trigger recovery agents
- Gateway crashes are detected and recovered
- Failed mutations are automatically reverted

---

### Phase 4: Continuous Evolution Loop 🔁

**Goal**: Background process that continuously evolves the agent

**Tasks:**

1. ⏳ Create evolution daemon/service
2. ⏳ Implement telemetry threshold monitoring
3. ⏳ Automatic evolution cycles based on performance degradation
4. ⏳ Automatic mutation cycles based on error patterns
5. ⏳ Capability growth tracking and reporting

**Files to Create:**

- `src/agents/evolution/evolution-daemon.ts` - Background service
- `src/agents/evolution/capability-tracker.ts` - Track improvements
- `src/commands/evolution.ts` - Add daemon start/stop commands

**Success Criteria:**

- Evolution daemon runs in background
- Automatically triggers evolution when fitness degrades
- Automatically triggers mutations when errors increase
- Reports capability growth over time

---

### Phase 5: Recursive Self-Improvement 🌀

**Goal**: Agents spawn sub-agents to improve themselves recursively

**Tasks:**

1. ⏳ Create recursive improvement protocol
2. ⏳ Implement sub-agent spawning for self-modification
3. ⏳ Add feedback loop from mutations to evolution
4. ⏳ Implement capability growth metrics
5. ⏳ Create self-improvement report system

**Files to Create:**

- `src/agents/evolution/recursive-improver.ts` - Recursive protocol
- `src/agents/evolution/capability-metrics.ts` - Growth tracking
- `src/agents/evolution/improvement-reporter.ts` - Report generation

**Success Criteria:**

- Agents can spawn sub-agents to fix bugs
- Mutations improve overall system capability
- Growth metrics show measurable improvement over time
- System becomes more capable without human intervention

---

## Key Metrics for AGI Success

### Autonomy Metrics

- **Self-Fix Rate**: % of bugs fixed without human intervention
- **Evolution Frequency**: How often evolution cycles run automatically
- **Mutation Success Rate**: % of mutations that improve fitness
- **Recovery Time**: Time to recover from failures automatically

### Capability Metrics

- **Tool Error Rate**: Should decrease over time
- **Task Success Rate**: Should increase over time
- **Token Efficiency**: Should improve (fewer tokens per task)
- **Response Quality**: User satisfaction should increase

### Growth Metrics

- **Capability Growth**: New capabilities added over time
- **Code Quality**: Maintainability and test coverage
- **System Stability**: Uptime and crash frequency
- **Evolution Generations**: Number of successful evolution cycles

---

## Safety Guardrails

### Critical Safety Rules

1. **Immutable Safety Core**
   - Security files (`src/agents/security/*`) are read-only
   - Policy files cannot be modified by agents
   - Authentication logic is protected

2. **Mutation Validation**
   - All mutations must pass Dojo tests
   - All mutations must pass build verification
   - All mutations must pass regression tests
   - Policy guard blocks dangerous changes

3. **Automatic Rollback**
   - Failed mutations are automatically reverted
   - Build failures trigger immediate rollback
   - Crash loops trigger rollback to last stable version

4. **Human Oversight**
   - Critical mutations require human approval (configurable)
   - Evolution reports are generated for review
   - Mutation history is logged and auditable

---

## Implementation Priority

### Immediate (This Week)

1. ⚡ Phase 1: Automatic Error Detection
2. 🔄 Phase 2: Automatic Mutation Cycles

### Short Term (Next 2 Weeks)

3. 🛠️ Phase 3: Self-Healing System
4. 🔁 Phase 4: Continuous Evolution Loop

### Medium Term (Next Month)

5. 🌀 Phase 5: Recursive Self-Improvement
6. 📊 Capability Growth Tracking
7. 📈 Performance Optimization

---

## Success Definition

**We've achieved AGI when:**

1. ✅ The agent fixes 80%+ of bugs without human intervention
2. ✅ Evolution cycles run automatically based on performance
3. ✅ Mutations consistently improve fitness scores
4. ✅ System capabilities grow measurably over time
5. ✅ Recovery from failures is automatic and reliable
6. ✅ The agent can improve itself recursively

**Current Status**: 🟡 **Phase 1 In Progress** (20% complete)

---

## Next Steps

1. Implement automatic error detection and diagnostic triggers
2. Integrate MutationWorkflow into Breeder
3. Create evolution daemon for continuous improvement
4. Add capability growth tracking
5. Test recursive self-improvement protocol

---

_This roadmap is a living document. Update as we progress and learn._
