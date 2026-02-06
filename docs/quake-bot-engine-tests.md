# Quake Bot Engine Test Suite

This document describes the comprehensive test suite for the Quake Bot Engine integration.

## Test Coverage

### Area Awareness System (AAS)

#### `context-graph.test.ts`

- ✅ ContextGraph.check() for all capability types (CanRead, CanWrite, CanNetwork, CanCommit, CanDeploy)
- ✅ ContextGraph.checkDetailed() with missing prerequisites
- ✅ File existence and permission checks
- ✅ Network and API key validation

#### `context-graph.real-checks.test.ts` (Real CLI Checks)

- ✅ Current simplified implementation behavior (file existence only)
- ✅ CanCommit limitation: does not verify git user.email config
- ✅ CanDeploy limitation: does not verify docker CLI or daemon
- ✅ Documentation of limitations and future enhancement path
- ✅ Expected behavior when real CLI checks are implemented

#### `reachability.test.ts`

- ✅ checkReachabilityType() for all reachability types (READ, WRITE, NETWORK, AUTH, ELEVATED)
- ✅ checkReachability() with multiple types
- ✅ getReachability() and getReachableAreas()
- ✅ canReach() for direct and transitive reachability
- ✅ getTransitionCost() and validateReachability()

#### `bsp-tree.test.ts`

- ✅ getContextDepth() for all depth levels (0-3)
- ✅ getContextDepthInfo() with descriptions
- ✅ filterContextByDepth() with maxDepthDiff
- ✅ isContextPortal() for portal file detection
- ✅ getContextPortals() for all portal files

#### `clusters.test.ts`

- ✅ getCluster() and getClusterForTool()
- ✅ getClustersForTools() and getAllToolsInCluster()
- ✅ getToolsForClusters() and filterToolsByCluster()
- ✅ resolveActiveClusters() and transitionCluster()

### Finite State Machine (FSM)

#### `states.test.ts`

- ✅ isValidState() and isValidQuakeNode()
- ✅ stateToQuakeNode() and quakeNodeToState() mappings
- ✅ isValidTransition() for all state transitions
- ✅ getStateDescription() and getQuakeNodeDescription()
- ✅ VALID_TRANSITIONS structure validation

#### `state-manager.test.ts`

- ✅ FSMStateManager initialization with default and custom states
- ✅ State transitions (valid and invalid)
- ✅ transitionToNode() using Quake nodes
- ✅ updateMetadata() and getStateRecord()
- ✅ State persistence to disk and loading
- ✅ getTimeInState() tracking

#### `transitions.test.ts`

- ✅ canTransition() validation
- ✅ getAllowedTransitions() for all states
- ✅ getDefaultTransition() with context (error, success, events)

#### `controller.test.ts`

- ✅ FSMController initialization and state history
- ✅ transition() and transitionDefault()
- ✅ forceTransition() for bypassing validation
- ✅ reset() and state descriptions
- ✅ isTerminalState(), isErrorState(), isWaitingState()

### Goal Stack

#### `stack.test.ts`

- ✅ GoalStack initialization (empty and with initial goals)
- ✅ push(), peek(), pop() operations
- ✅ activate(), complete(), fail() status changes
- ✅ blockCurrent() and unblock() obstacle handling
- ✅ getActive(), getBlocked() filtering
- ✅ serialize() and deserialize() persistence
- ✅ clear() operation

#### `stack.session-store.test.ts` (Session Store Integration)

- ✅ Save goal stack to session store
- ✅ Load goal stack from session store
- ✅ Preserve goal relationships when loading
- ✅ Handle missing goal stack in session entry
- ✅ Handle empty goal stack array
- ✅ Update goal stack in existing session entry
- ✅ Integration with quake-integration helper

#### `visualizer.test.ts`

- ✅ visualizeGoalStack() for all goal states
- ✅ summarizeGoalStack() with counts
- ✅ renderGoalStackSummary() alias

### Camping State Manager

#### `camping.test.ts`

- ✅ enterCamping() with all trigger types
- ✅ isCamping() and getCamping()
- ✅ exitCamping() and getAllCamping()
- ✅ isTimedOut() timeout checking
- ✅ restoreCamping() from persisted state
- ✅ clear() operation

#### `camping.store.test.ts`

- ✅ saveCampingState() to disk
- ✅ loadCampingState() from disk
- ✅ deleteCampingState() cleanup
- ✅ Error handling for invalid files

#### `timer.camping-wake.test.ts` (Camping Wake Events)

- ✅ Automatic wake-up when camping cron job completes successfully
- ✅ Session ID resolution (agentId vs job.id)
- ✅ Wake-up only for jobs with camping metadata
- ✅ Wake-up only when job status is "ok"
- ✅ Error handling when exiting camping fails
- ✅ Multiple sessions with different agentIds
- ✅ Camping job metadata validation

#### `cron-tool.test.ts` (Camp Action)

- ✅ Creates camping job with webhook condition
- ✅ Default timeout of 60 minutes
- ✅ Custom timeout support
- ✅ Wake message truncation in job name
- ✅ Required parameter validation (condition, wakeMessage)
- ✅ AgentId from session key
- ✅ Job metadata structure (camping flag, condition)

### Personality System

#### `soul-loader.test.ts`

- ✅ loadSoul() when SOUL.md exists and doesn't exist
- ✅ Trait extraction from SOUL.md
- ✅ Response style detection (brief, detailed)
- ✅ Synonym extraction
- ✅ hasSoulChanged() file modification detection

#### `contextual-triggers.test.ts`

- ✅ getTraitForEvent() for all event types
- ✅ SOUL.md trait overrides
- ✅ isLateNight() time detection
- ✅ Response style application

#### `formatter.test.ts`

- ✅ formatToolStart(), formatToolSuccess(), formatToolError()
- ✅ formatPlanning(), formatWaiting(), formatCompleted()
- ✅ Synonym dictionary integration
- ✅ Options for enabling/disabling synonyms

### Integration

#### `quake-integration.test.ts`

- ✅ initializeQuakeIntegration() with all components
- ✅ FSM state loading from disk
- ✅ Goal stack initialization
- ✅ SOUL.md loading and default synonyms
- ✅ Camping state restoration
- ✅ persistQuakeIntegration() for all components
- ✅ cleanupQuakeIntegration() lifecycle
- ✅ Full integration flow (init -> use -> persist -> cleanup)
- ✅ State restoration on re-initialization

### Fuzzy Model Selector

#### `fuzzy-selector.test.ts` (existing)

- ✅ analyzeTaskComplexity() for simple and complex tasks
- ✅ calculateContextBudget() with various token usage
- ✅ selectModelFuzzy() model selection logic

### Self-Evolution System

#### `telemetry.test.ts`

- ✅ logSessionStats() to JSONL file
- ✅ Fitness calculation with userSatisfaction
- ✅ Tool error tracking
- ✅ Multiple session logging
- ✅ calculateFitness() with success, efficiency, and satisfaction
- ✅ getAggregatedStats() for genotype evaluation

#### `genotype.test.ts`

- ✅ saveGenotype() and loadGenotype() persistence
- ✅ Default genotype creation
- ✅ Sync versions (saveGenotypeSync, loadGenotypeSync)
- ✅ mutateGenotype() with mutation rate
- ✅ Parent lineage preservation
- ✅ interbreedGenotypes() trait averaging
- ✅ Tool preference merging

#### `dojo.test.ts`

- ✅ DOJO_TASKS structure validation
- ✅ runDojoTask() with custom agent runner
- ✅ Task weight application to fitness
- ✅ Workspace directory creation
- ✅ runDojoSuite() for full evaluation
- ✅ Average fitness and success rate calculation
- ✅ Subset of tasks execution

#### `breeder.test.ts`

- ✅ createVariants() from base genotype
- ✅ Variant characteristics (tool eagerness, system prompt, mutation)
- ✅ evaluateGenotypes() using aggregated stats
- ✅ Fitness-based sorting
- ✅ evolve() full evolution cycle
- ✅ Next generation creation from winner

### Synonyms

#### `synonyms.test.ts` (existing)

- ✅ selectSynonym() with default and custom dictionaries
- ✅ customizeSynonyms() merging

## Test Execution

Run all tests:

```bash
pnpm test
```

Run specific test file:

```bash
pnpm test src/agents/aas/context-graph.test.ts
```

Run with coverage:

```bash
pnpm test:coverage
```

## Test Structure

All tests follow Vitest conventions:

- `describe()` blocks for grouping related tests
- `it()` or `test()` for individual test cases
- `beforeEach()` and `afterEach()` for setup/cleanup
- Temporary directories created in `os.tmpdir()`
- All temporary files cleaned up after tests

## Coverage Goals

- **Lines**: 70% (threshold)
- **Functions**: 70% (threshold)
- **Branches**: 55% (threshold)
- **Statements**: 70% (threshold)

## Known Test Limitations

1. **ContextGraph Real Checks**: The current implementation uses simplified file existence checks rather than real Docker/Git CLI validation. Tests document this limitation and verify current behavior. Future enhancement would add real CLI checks (`git config user.email`, `docker --version`, `docker ps`).

## Future Test Additions

1. **Integration E2E Tests**: End-to-end tests that exercise the full Quake integration flow with real agent runs.

2. **Performance Tests**: Tests for BSP filtering efficiency, goal stack operations at scale, and state persistence performance.

3. **Evolution System Tests**: Comprehensive tests for telemetry logging, genotype mutation/interbreeding, dojo evaluation, and breeder evolution cycles.

4. **Tool Execution Hooks**: Tests for reachability validation before tool execution (when feature is implemented).

5. **Synonym Formatter Integration**: Tests for synonym formatters in tool output handlers (when feature is implemented).

6. **Camping Wake E2E Tests**: End-to-end tests that verify the full flow from creating a camping job via cron tool, to webhook triggering, to automatic wake-up (requires gateway integration).

## Maintenance

When adding new Quake components:

1. Create corresponding test file: `component-name.test.ts`
2. Follow existing test patterns and structure
3. Ensure cleanup in `afterEach()` hooks
4. Add test file to this documentation
5. Update coverage thresholds if needed

---

_Last updated: February 2026_
