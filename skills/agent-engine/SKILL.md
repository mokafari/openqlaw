---
name: agent-engine
description: Orchestrate parallel sub-agent execution with a task queue. Use when spawning multiple independent agents, running batch jobs, parallelizing work across modules/files, or building agent pipelines. Handles concurrency limits, progress tracking, and result aggregation.
---

# Agent Engine

Spawn and manage a queue of sub-agents for parallel or sequential execution.

## Core Pattern

```
Queue:  [task1] → [task2] → [task3] → ...
                    ↓
Active: [🔨 A]  [🔨 B]  (max_concurrent)
                    ↓
Done:   [✓] → spawn next → aggregate results
```

## Quick Start

### 1. Define the Queue

Create a task manifest (JSON array or inline):

```json
[
  { "id": "audio", "task": "Implement audio decoder module", "deps": [] },
  { "id": "ui", "task": "Build UI components", "deps": [] },
  { "id": "storage", "task": "Implement storage layer", "deps": [] },
  { "id": "integration", "task": "Wire modules together", "deps": ["audio", "ui", "storage"] }
]
```

### 2. Spawn with Concurrency

Spawn independent tasks (no deps) first, up to `max_concurrent`:

```
sessions_spawn(task="...", label="engine-audio")
sessions_spawn(task="...", label="engine-ui")
```

### 3. Track Progress

Use `sessions_list` to monitor active agents:

```
sessions_list(kinds=["subagent"], messageLimit=1)
```

Check for completion by label pattern or session status.

### 4. Handle Completion

When an agent completes:

1. Log result to `memory/engine-run-{timestamp}.md`
2. Check if dependent tasks are unblocked
3. Spawn next task from queue

## Orchestration Strategies

### Parallel (fire-and-forget)

Spawn all at once, aggregate when all done:

- Good for: independent modules, research tasks, batch processing
- Set `max_concurrent` to task count

### Pipeline (sequential with handoff)

Each task's output feeds the next:

- Good for: build systems, data pipelines, review chains
- Set `max_concurrent: 1`, use `deps` for ordering

### Hybrid (bounded parallelism)

Mix parallel and sequential:

- Good for: complex builds, multi-phase projects
- Group by phase, parallelize within phase

## State Tracking

Track queue state in workspace:

```
workspace/
└── engine-state.json
    {
      "runId": "djs3-2026-02-06",
      "queue": [...],
      "active": ["engine-audio", "engine-ui"],
      "completed": {"engine-storage": "success"},
      "failed": {}
    }
```

## Task Specification

Each task should include:

| Field     | Required | Description                                |
| --------- | -------- | ------------------------------------------ |
| `id`      | Yes      | Unique identifier                          |
| `task`    | Yes      | Full prompt for sub-agent                  |
| `deps`    | No       | Array of task IDs that must complete first |
| `label`   | No       | Session label (defaults to `engine-{id}`)  |
| `timeout` | No       | Timeout in seconds (default: 3600)         |
| `model`   | No       | Override model for this task               |

## Aggregation

When all tasks complete, aggregate results:

1. Collect outputs from `sessions_history` for each completed session
2. Summarize in `memory/engine-run-{runId}-summary.md`
3. Report to parent session or channel

## Error Handling

- **Task failure**: Log error, mark task failed, continue with independent tasks
- **Timeout**: Kill session, mark failed, optionally retry
- **Dependency failure**: Skip dependent tasks, mark as `blocked`

## Example: Firmware Modules

```json
[
  { "id": "waveform", "task": "Fix waveform ghosting in waveform_view.c..." },
  { "id": "id3", "task": "Fix ID3 tag parsing in track_metadata.c..." },
  { "id": "ui-time", "task": "Add time display toggle to UI..." },
  {
    "id": "integration",
    "task": "Verify all modules work together",
    "deps": ["waveform", "id3", "ui-time"]
  }
]
```

Spawn waveform, id3, ui-time in parallel → wait → spawn integration.
