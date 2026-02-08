# Dojo Test Plan - 2026-02-08

## Overview

This document outlines the test infrastructure for fast Dojo iteration, focusing on evolution, mutation, and core tool tests.

**Total Test Files Found:** 976 tests across the codebase
**Evolution-specific Tests:** 13 test files with 108+ test cases
**Memory Tests:** 13 test files

---

## 1. Dojo Infrastructure Location

### Primary Dojo Files

```
~/openclaw/src/agents/evolution/
├── dojo.ts                 # Core Dojo tasks & runner (5 standard tasks)
├── dojo.test.ts            # 10 tests - Dojo validation
├── dojo-runner.ts          # Docker-based sandboxed execution
├── breeder.ts              # Evolution breeding logic
├── genotype.ts             # Agent genotype management
├── mutation-workflow.ts    # Mutation orchestration
├── patches.ts              # Patch management
├── patch-parser-advanced.ts # Unified diff parsing
└── telemetry.ts            # Fitness & metrics
```

### Standard Dojo Tasks (5 tasks)

| ID       | Name              | Weight | Description               |
| -------- | ----------------- | ------ | ------------------------- |
| task-001 | Fix Syntax Error  | 1.0    | Fix JS syntax error       |
| task-002 | Dockerize Script  | 1.2    | Create Dockerfile         |
| task-003 | Refactor Function | 1.5    | Reduce nesting, add types |
| task-004 | Write Test        | 1.3    | Write comprehensive tests |
| task-005 | Document Code     | 1.0    | Add JSDoc comments        |

---

## 2. Top 10 Integration Tests

### Evolution Tests (Priority Order)

| #   | Test File                              | Tests | Runtime | Purpose                      |
| --- | -------------------------------------- | ----- | ------- | ---------------------------- |
| 1   | `dojo.test.ts`                         | 10    | ~1.1s   | Core Dojo task validation    |
| 2   | `patch-parser-advanced.test.ts`        | 27    | ~1.1s   | Patch parsing & application  |
| 3   | `telemetry.test.ts`                    | 20    | ~1.1s   | Fitness calculation & stats  |
| 4   | `breeder.test.ts`                      | 6     | ~1.3s   | Evolution cycle validation   |
| 5   | `genotype.test.ts`                     | 8     | ~1.1s   | Genotype mutation & breeding |
| 6   | `recovery-loop.test.ts`                | 5     | ~3.5s   | Build failure recovery       |
| 7   | `gateway-recovery.integration.test.ts` | 3     | ~2.0s   | End-to-end recovery          |
| 8   | `auto-satisfaction.test.ts`            | 8+    | ~1.5s   | Satisfaction inference       |
| 9   | `error-analyzer.test.ts`               | 4+    | ~1.0s   | Error classification         |
| 10  | `git-tools.test.ts`                    | 6+    | ~1.2s   | Git operations               |

### Memory Tests (Supporting)

| #   | Test File                | Tests | Purpose            |
| --- | ------------------------ | ----- | ------------------ |
| 1   | `hybrid.test.ts`         | 4     | FTS + vector merge |
| 2   | `search-manager.test.ts` | 2     | Manager caching    |
| 3   | `index.test.ts`          | 5+    | Core memory ops    |

---

## 3. Test Status (Current)

### All Passing ✅

```
✓ dojo.test.ts            - 10/10 passing
✓ patch-parser-advanced   - 27/27 passing
✓ telemetry.test.ts       - 20/20 passing
✓ breeder.test.ts         - 6/6 passing
✓ genotype.test.ts        - 8/8 passing
✓ recovery-loop.test.ts   - 5/5 passing
✓ hybrid.test.ts          - 4/4 passing
```

### Known Behaviors

- `recovery-loop.test.ts` emits expected gateway connection errors (logged but pass)
- Tests use temp directories for isolation
- Docker-based tests require Docker daemon

---

## 4. Fast Iteration Test Plan

### Priority 1: Core Evolution (5 tests, ~6s total)

```bash
# Quick validation suite - run after any evolution change
cd ~/openclaw && npx vitest run \
  src/agents/evolution/dojo.test.ts \
  src/agents/evolution/genotype.test.ts \
  src/agents/evolution/patch-parser-advanced.test.ts \
  src/agents/evolution/telemetry.test.ts \
  src/agents/evolution/breeder.test.ts \
  --reporter=verbose
```

**Expected Results:**
| Test | Expected | Runtime |
|---|---|---|
| dojo.test.ts | 10 pass | 1.1s |
| genotype.test.ts | 8 pass | 1.1s |
| patch-parser-advanced.test.ts | 27 pass | 1.1s |
| telemetry.test.ts | 20 pass | 1.1s |
| breeder.test.ts | 6 pass | 1.3s |
| **Total** | **71 pass** | **~5.7s** |

### Priority 2: Integration (2 tests, ~5.5s)

```bash
# Run after core passes - tests recovery flows
cd ~/openclaw && npx vitest run \
  src/agents/evolution/recovery-loop.test.ts \
  src/agents/evolution/gateway-recovery.integration.test.ts \
  --reporter=verbose
```

### Priority 3: Extended Suite (all evolution tests)

```bash
# Full evolution validation
cd ~/openclaw && npx vitest run src/agents/evolution/*.test.ts --reporter=verbose
```

---

## 5. Quick Command Reference

### Single Test Run

```bash
# Run specific Dojo test
cd ~/openclaw && npx vitest run src/agents/evolution/dojo.test.ts

# Run with watch mode for iteration
cd ~/openclaw && npx vitest watch src/agents/evolution/dojo.test.ts
```

### Pattern-Based Testing

```bash
# All evolution tests
npx vitest run 'src/agents/evolution/*.test.ts'

# All memory tests
npx vitest run 'src/memory/*.test.ts'

# Specific test by name
npx vitest run -t "should run a dojo task"
```

### Coverage

```bash
npm run test:coverage -- --include="src/agents/evolution/**"
```

### Full Suite (before commits)

```bash
npm test  # Runs all 976 tests via parallel runner
```

---

## 6. Test Dependencies

### System Requirements

- Node.js 22+
- Docker (for dojo-runner.ts)
- pnpm (package manager)
- vitest 4.0.18+

### Test Isolation

- Each test creates temp directories via `fs.mkdtemp`
- Cleanup in `afterEach` hooks
- No shared state between tests

### Mocking Patterns

- Memory tests mock `QmdMemoryManager`
- Gateway tests mock Docker execution
- Agent runner uses `customRunner` injection

---

## 7. Recommended Test Frequency

| Activity           | Test Suite           | Frequency      |
| ------------------ | -------------------- | -------------- |
| Active development | Priority 1 (core)    | Every change   |
| Before commits     | Priority 1 + 2       | Each commit    |
| Daily validation   | Full evolution suite | Once/day       |
| Release prep       | `npm test` (all)     | Before release |

### CI/CD Integration

```yaml
# Suggested workflow
steps:
  - run: npm ci
  - run: npm run build
  - run: npx vitest run src/agents/evolution/*.test.ts # Fast gate
  - run: npm test # Full suite
```

---

## 8. Using evolution_run_dojo_test Tool

The agent has access to `evolution_run_dojo_test` for validating patches:

```
# Validate a specific patch
evolution_run_dojo_test(taskId: "task-001", patchId: "abc-123")

# Test current genotype
evolution_run_dojo_test(taskId: "task-001")

# Available tasks: task-001 through task-005
```

---

## 9. Next Steps

1. **Execute Priority 1 tests** to verify baseline
2. **Set up watch mode** for active development
3. **Create pre-commit hook** running Priority 1
4. **Track test runtime trends** for regression detection

---

_Generated: 2026-02-08 12:21 GMT+1_
_Test infrastructure version: vitest 4.0.18_
