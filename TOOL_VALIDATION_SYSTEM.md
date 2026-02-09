# Tool Validation System

## Overview

Comprehensive framework for testing all 35+ tools to ensure they work correctly and integrate properly with agents.

## Components

### 1. Tool Inventory (`TOOL_INVENTORY.md`)

- Complete list of all available tools
- Categorized by risk level (LOW/MEDIUM/HIGH)
- Organized by category (File Ops, Execution, Browser, Memory, Gateway, etc)
- Validation framework design

### 2. Tool Validator (`src/tools/tool-validator.ts`)

- Dynamic test runner for all tools
- Categories: availability, functionality, integration, performance, safety
- Quick tests for heartbeat monitoring
- Generates validation reports

### 3. Test Coverage Matrix

```
AVAILABILITY TESTS (35 tests)
├─ Can tool be called? ✓
├─ Does it have correct signature? ✓
├─ Error handling for missing params? ✓
└─ Quick availability check <1s

FUNCTIONALITY TESTS (35 tests)
├─ Basic operation works ✓
├─ Return types match spec ✓
├─ Error cases handled ✓
├─ Recovery suggestions provided ✓
└─ ~5-10s per test

INTEGRATION TESTS (50+ tests)
├─ Tools work together ✓
├─ Chaining operations ✓
├─ State consistency ✓
└─ ~10-20s per test

PERFORMANCE TESTS (10+ tests)
├─ Latency within limits ✓
├─ Memory usage ok ✓
├─ Handles large inputs ✓
└─ Benchmark against baseline

SAFETY TESTS (15+ tests)
├─ Permissions enforced ✓
├─ High-risk ops blocked ✓
├─ Rollback capability ✓
└─ No side effects outside scope
```

## Usage

### CLI Commands (To Implement)

```bash
# Run all tool tests
openclaw tools.test --all

# Run quick tests (heartbeat)
openclaw tools.test --quick

# Run by category
openclaw tools.test --category functionality
openclaw tools.test --category safety

# Run by risk level
openclaw tools.test --risk low     # Safe to run anytime
openclaw tools.test --risk medium  # Needs validation
openclaw tools.test --risk high    # Needs confirmation

# Generate report
openclaw tools.test --report output.md

# List all tools
openclaw tools.list

# Check single tool
openclaw tools.check exec
```

### Cron Schedules

```json
{
  "heartbeat": {
    "frequency": "every 5 min",
    "tests": "quick (5 tests)",
    "timeout": "30s",
    "alert": "if any fail"
  },
  "hourly": {
    "frequency": "every 1h",
    "tests": "availability (35 tests)",
    "timeout": "2min",
    "alert": "if >2 fail"
  },
  "daily-deep": {
    "frequency": "2 AM daily",
    "tests": "functionality (35 tests)",
    "timeout": "10min",
    "alert": "any failure"
  },
  "weekly-full": {
    "frequency": "Sunday 3 AM",
    "tests": "all + integration",
    "timeout": "30min",
    "report": "generate report"
  },
  "monthly-stress": {
    "frequency": "1st of month",
    "tests": "performance + safety",
    "timeout": "1hour",
    "benchmark": "track trends"
  }
}
```

## Test Structure

Each test validates:

1. **Availability** — Can the tool be called?
   - Function exists
   - Correct module loaded
   - Accessible from agent

2. **Functionality** — Does it work correctly?
   - Operation completes
   - Returns expected type
   - Error handling works

3. **Integration** — Does it work with other tools?
   - Can chain with other tools
   - State is consistent
   - No unexpected side effects

4. **Performance** — Does it perform?
   - Latency within limits
   - Memory usage acceptable
   - Scales with load

5. **Safety** — Is it safe?
   - Permissions enforced
   - Dangerous ops blocked
   - Can rollback/recover

## Recovery System

Each failed test includes recovery suggestion:

```
Tool: exec
Status: FAILED
Error: "Command timeout after 30s"
Recovery: "Check if process is stuck; run 'process action=kill'"

Tool: browser
Status: DEGRADED
Error: "Connection refused"
Recovery: "Start browser with 'browser action=start'"

Tool: message
Status: FAILED
Error: "API rate limit exceeded"
Recovery: "Wait 1 hour; check message queue"
```

## Health Score Calculation

```
Health Score = (Passed Tests / Total Tests) × 100

🟢 GREEN   (90-100%)  → All systems nominal
🟡 YELLOW  (70-89%)   → Some degradation, monitor
🔴 RED     (0-69%)    → Critical failures, action needed
```

## Integration with Evolution System

```
Tool Validation ──→ Health Score ──→ Evolution Decision
     ✓ All green        1.0         → Deploy normally
     ✓ Minor failures   0.95        → Deploy with caution
     ✗ Major failures   0.80        → Block deployment
     ✗ Critical         0.00        → Immediate recovery
```

## Example Report

```markdown
# Tool Validation Report

**Generated:** 2026-02-09T12:15:00Z
**Session:** main

## Summary

- Total Tests: 35
- Passed: 34
- Failed: 1
- Health Score: 97.1%

## Results by Category

- Availability: 35/35 ✅
- Functionality: 34/35 ⚠️ (exec timeout)
- Integration: 15/15 ✅

## Degraded Tools

- exec (timeout on large commands)
  Recovery: Check process limits with `process action=list`

## Recommendations

1. Investigate exec timeouts on commands >30s
2. Consider increasing timeout for long-running operations
3. Monitor process memory usage

## Next Steps

1. Run daily-deep test tomorrow 2 AM
2. Weekly full test Sunday 3 AM
3. Re-test exec tool after investigation
```

## Implementation Roadmap

### Phase 1 (Done)

- [x] Tool inventory document
- [x] Test validator framework
- [x] Test structure design

### Phase 2 (Next)

- [ ] CLI commands for tool testing
- [ ] Cron jobs for periodic testing
- [ ] Report generation

### Phase 3

- [ ] Dashboard visualization
- [ ] Automatic recovery procedures
- [ ] Evolution integration

### Phase 4

- [ ] Performance benchmarking
- [ ] Load testing
- [ ] Chaos engineering tests

## Benefits

1. **Early Detection** — Catch tool failures before they impact operations
2. **Faster Recovery** — Built-in recovery suggestions
3. **Data-Driven Decisions** — Validation results inform evolution
4. **Transparency** — Clear health metrics and status
5. **Continuous Improvement** — Automated testing drives quality
