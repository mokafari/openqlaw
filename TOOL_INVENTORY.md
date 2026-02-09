# Complete Tool Inventory & Validation Framework

Generated: 2026-02-09 12:15 CET

## Available Tools (35 core + dynamic)

### File Operations

| Tool    | Purpose                          | Status |
| ------- | -------------------------------- | ------ |
| `Read`  | Read file contents (text/images) | ✓ Core |
| `Write` | Write/create files               | ✓ Core |
| `Edit`  | Replace exact text in files      | ✓ Core |

### Execution

| Tool      | Purpose                     | Status |
| --------- | --------------------------- | ------ |
| `exec`    | Run shell commands          | ✓ Core |
| `process` | Manage background processes | ✓ Core |

### System

| Tool      | Purpose                                | Status |
| --------- | -------------------------------------- | ------ |
| `browser` | Browser automation (Chrome/Playwright) | ✓ Core |
| `canvas`  | Node.js canvas rendering               | ✓ Core |
| `nodes`   | Device/node control (camera, screen)   | ✓ Core |
| `tts`     | Text-to-speech conversion              | ✓ Core |

### Messaging & Communication

| Tool             | Purpose                                        | Status |
| ---------------- | ---------------------------------------------- | ------ |
| `message`        | Send/receive messages (iMessage, Discord, etc) | ✓ Core |
| `read_imessages` | Read iMessage history                          | ✓ Core |

### Gateway & Configuration

| Tool              | Purpose                             | Status |
| ----------------- | ----------------------------------- | ------ |
| `gateway`         | Gateway control & config            | ✓ Core |
| `rebuild_gateway` | Rebuild and restart gateway         | ✓ Core |
| `cron`            | Schedule jobs (list/add/remove/run) | ✓ Core |

### Sessions & Agents

| Tool               | Purpose                       | Status |
| ------------------ | ----------------------------- | ------ |
| `sessions_list`    | List active sessions          | ✓ Core |
| `sessions_history` | Fetch session message history | ✓ Core |
| `sessions_send`    | Send message to other session | ✓ Core |
| `sessions_spawn`   | Spawn background agent        | ✓ Core |
| `agents_list`      | List available agents         | ✓ Core |

### Evolution & Meta-Learning

| Tool                             | Purpose                                 | Status |
| -------------------------------- | --------------------------------------- | ------ |
| `evolution_propose_patch`        | Propose code patch for self-improvement | ✓ Core |
| `evolution_run_dojo_test`        | Test patch with Dojo                    | ✓ Core |
| `evolution_list_patches`         | List patches by status                  | ✓ Core |
| `evolution_apply_approved_patch` | Apply validated patch                   | ✓ Core |
| `calibration_helper`             | Predict & calibrate task difficulty     | ✓ Core |
| `meta_learning`                  | Log predictions and outcomes            | ✓ Core |

### Memory & Knowledge

| Tool              | Purpose                     | Status |
| ----------------- | --------------------------- | ------ |
| `memory_search`   | Semantic search of memory   | ✓ Core |
| `memory_get`      | Read memory file snippets   | ✓ Core |
| `memory_browse`   | Browse memory structure     | ✓ Core |
| `episodic_recall` | Retrieve past episodes      | ✓ Core |
| `semantic_query`  | Query generalized knowledge | ✓ Core |

### Web & Search

| Tool         | Purpose                     | Status |
| ------------ | --------------------------- | ------ |
| `web_search` | Search via Brave Search API | ✓ Core |
| `web_fetch`  | Fetch & extract web content | ✓ Core |

### Analysis & Monitoring

| Tool                  | Purpose                       | Status |
| --------------------- | ----------------------------- | ------ |
| `session_diff`        | Compare sessions semantically | ✓ Core |
| `session_status`      | Session usage/cost dashboard  | ✓ Core |
| `behavioral_analyzer` | Analyze behavioral patterns   | ✓ Core |
| `latency_benchmark`   | Benchmark core operations     | ✓ Core |

### Dynamic Tool Management

| Tool                 | Purpose              | Status |
| -------------------- | -------------------- | ------ |
| `create_tool`        | Create runtime tools | ✓ Core |
| `remove_tool`        | Remove dynamic tools | ✓ Core |
| `list_dynamic_tools` | List created tools   | ✓ Core |

### Goal & Task Management

| Tool           | Purpose                  | Status |
| -------------- | ------------------------ | ------ |
| `goal_push`    | Push goal onto stack     | ✓ Core |
| `goal_pop`     | Pop completed goal       | ✓ Core |
| `goal_status`  | Get goal stack status    | ✓ Core |
| `goal_block`   | Block goal with obstacle | ✓ Core |
| `goal_unblock` | Resolve obstacle         | ✓ Core |

### Composition

| Tool            | Purpose              | Status |
| --------------- | -------------------- | ------ |
| `compose_tool`  | Chain multiple tools | ✓ Core |
| `list_composed` | List composed tools  | ✓ Core |

---

## Tool Categories by Risk Level

### 🟢 LOW RISK (Safe Operations)

- File reads, searches, fetches
- Status checks, history queries
- Memory operations
- Read-only sessions

### 🟡 MEDIUM RISK (Requires Validation)

- File writes/edits
- Message sending
- Config changes
- Session spawning

### 🔴 HIGH RISK (Needs Consensus)

- Gateway restart
- Code patches/deployment
- Evolution changes
- Critical config modifications

---

## Tool Validation Framework

### Test Categories

#### 1. **Availability Tests**

- Tool exists and is callable
- Expected function signature
- Error handling for missing params

#### 2. **Functionality Tests**

- Basic operation works
- Return type matches spec
- Error cases handled

#### 3. **Integration Tests**

- Works with other tools
- Chaining operations
- State consistency

#### 4. **Performance Tests**

- Latency within limits
- No memory leaks
- Handles large inputs

#### 5. **Safety Tests**

- Permission checks work
- Dangerous ops blocked if needed
- Rollback capability

---

## Creating Dynamic Tool Tests

### Test Structure

```typescript
export interface ToolTest {
  toolName: string;
  category: "availability" | "functionality" | "integration" | "performance" | "safety";
  test: () => Promise<{ success: boolean; error?: string; metrics?: Record<string, unknown> }>;
  timeout: number;
  riskLevel: "low" | "medium" | "high";
}
```

### Example Test Suite

```bash
# Run all tool tests
openclaw tools.test --all

# Run by category
openclaw tools.test --category functionality

# Run high-risk with confirmation
openclaw tools.test --risk high --confirm

# Run and generate report
openclaw tools.test --report tools-report-2026-02-09.md
```

---

## Recommended Test Schedule

| Frequency   | Tests                   | When         |
| ----------- | ----------------------- | ------------ |
| Per session | Core tools (5)          | On startup   |
| Hourly      | Availability (35)       | Heartbeat    |
| Daily       | Functionality (35)      | 2 AM         |
| Weekly      | Integration suite (50+) | Sunday 3 AM  |
| Monthly     | Performance + Safety    | 1st of month |

---

## Priority Improvements

1. **Tool Health Dashboard** — Real-time tool status
2. **Automatic Recovery** — Auto-restart failed tools
3. **Canary Tests** — Run before real operations
4. **Tool Metrics** — Track success rate, latency per tool
5. **Circuit Breaker** — Disable tools on repeated failures
