# Cognee Memory Integration

This document describes the integration of Cognee memory system into OpenClaw.

## Architecture

The integration uses a Python bridge pattern:

```
TypeScript Plugin (index.ts)
    ↓ subprocess call
Python Bridge (bridge.py)
    ↓ async API
Cognee Library
    ↓
Knowledge Graph + Vector Store
```

## Components

### 1. TypeScript Plugin (`index.ts`)

- Implements OpenClaw plugin API
- Provides tools: `memory_recall`, `memory_store`, `memory_forget`
- Handles lifecycle hooks for auto-capture/recall
- Manages subprocess calls to Python bridge

### 2. Python Bridge (`bridge.py`)

- JSON-based CLI interface
- Wraps Cognee async API
- Handles configuration via environment variables
- Returns structured JSON responses

### 3. Configuration (`config.ts`)

- Validates plugin configuration
- Supports multiple LLM providers
- Configurable data directory
- Optional vector/graph store backends

## Data Flow

### Storing Memory

1. Agent calls `memory_store` tool
2. TypeScript plugin calls Python bridge `add` command
3. Bridge adds text to Cognee
4. Background: `cognify()` generates knowledge graph
5. Background: `memify()` adds memory algorithms

### Searching Memory

1. Agent calls `memory_recall` tool
2. TypeScript plugin calls Python bridge `search` command
3. Bridge queries Cognee (graph + vector search)
4. Results formatted and returned to agent

## Configuration Example

```json
{
  "plugins": {
    "slots": {
      "memory": "memory-cognee"
    },
    "entries": {
      "memory-cognee": {
        "enabled": true,
        "config": {
          "llm": {
            "provider": "openai",
            "apiKey": "${OPENAI_API_KEY}",
            "model": "gpt-4o-mini"
          },
          "dataDir": "~/.openclaw/memory/cognee",
          "autoCapture": true,
          "autoRecall": true
        }
      }
    }
  }
}
```

## Differences from memory-lancedb

| Feature       | memory-lancedb        | memory-cognee              |
| ------------- | --------------------- | -------------------------- |
| Storage       | Vector only (LanceDB) | Graph + Vector (Cognee)    |
| Relationships | None                  | Automatic graph generation |
| Search        | Vector similarity     | Hybrid (graph + vector)    |
| Language      | TypeScript            | Python bridge              |
| Setup         | Node.js only          | Requires Python 3.10+      |

## Future Enhancements

- [ ] Support for selective deletion (by query, not just all)
- [ ] Batch operations for better performance
- [ ] Graph visualization tools
- [ ] Integration with Cognee's web UI
- [ ] Support for Cognee's document ingestion pipelines
