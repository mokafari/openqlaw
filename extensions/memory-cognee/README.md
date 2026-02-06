# Memory (Cognee) Plugin

OpenClaw memory plugin powered by [Cognee](https://github.com/topoteretes/cognee) - a knowledge graph + vector search system for AI agents.

## Features

- **Graph + Vector Search**: Combines knowledge graphs with vector embeddings for better context retrieval
- **Automatic Knowledge Graph Generation**: Automatically builds relationships between stored memories
- **Hybrid Search**: Searches both by semantic similarity and graph relationships
- **Auto-Capture & Auto-Recall**: Automatically captures important information and recalls relevant context

## Installation

### 1. Install Python Dependencies

```bash
pip install -r extensions/memory-cognee/requirements.txt
```

Or install Cognee directly:

```bash
pip install cognee
```

### 2. Enable the Plugin

Add to your OpenClaw config:

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

## Configuration

### LLM Provider

Supports multiple LLM providers:

- `openai` (default) - Requires `OPENAI_API_KEY`
- `anthropic` - Requires `ANTHROPIC_API_KEY`
- `google` - Requires `GOOGLE_API_KEY`
- `ollama` - Local Ollama instance

### Vector Store (Optional)

Configure vector database backend:

- `qdrant` (default)
- `lancedb`
- `chroma`
- `weaviate`
- `pinecone`

### Graph Store (Optional)

Configure graph database backend:

- `neo4j` (default, requires Neo4j instance)
- `networkx` (in-memory, no setup required)

## Usage

### Agent Tools

The plugin provides three tools:

1. **`memory_recall`** - Search memories using graph + vector search
2. **`memory_store`** - Store new memories (automatically generates graph relationships)
3. **`memory_forget`** - Delete all memories (requires confirmation)

### CLI Commands

```bash
# Add text to memory
openclaw cognee add "User prefers dark mode"

# Search memories
openclaw cognee search "user preferences" --limit 5

# Generate knowledge graph
openclaw cognee cognify

# Add memory algorithms
openclaw cognee memify

# Delete all memories
openclaw cognee delete --confirm
```

## How It Works

1. **Add**: Text is added to Cognee's data layer
2. **Cognify**: Generates a knowledge graph from the data (extracts entities, relationships)
3. **Memify**: Adds memory algorithms to the graph for better recall
4. **Search**: Queries both the vector embeddings and graph relationships

## Auto-Capture & Auto-Recall

- **Auto-Capture**: Automatically detects and stores important information from conversations (preferences, decisions, facts)
- **Auto-Recall**: Injects relevant memories into context before agent starts processing

Both features can be disabled in config:

```json
{
  "autoCapture": false,
  "autoRecall": false
}
```

## Differences from memory-lancedb

- **Graph Relationships**: Cognee builds knowledge graphs, not just vector embeddings
- **Hybrid Search**: Searches by both meaning (vectors) and relationships (graphs)
- **Automatic Graph Generation**: No manual relationship management needed
- **Python-based**: Uses Cognee Python library via bridge (requires Python 3.10+)

## Troubleshooting

### Python Not Found

Ensure `python3` is in your PATH:

```bash
which python3
```

### Cognee Not Installed

Install Cognee:

```bash
pip install cognee
```

### Cognee Dependency Error (starlette)

If you see an error like `HTTP_422_UNPROCESSABLE_CONTENT`, this is a known Cognee dependency issue. Fix it with:

```bash
pip install --upgrade starlette fastapi
```

Or install a specific compatible version:

```bash
pip install starlette>=0.37.0 fastapi>=0.104.0
```

### Permission Errors

Make the bridge script executable:

```bash
chmod +x extensions/memory-cognee/bridge.py
```

### Plugin Not Working / UI Dashboard Issues

If the plugin is causing UI dashboard issues:

1. **Disable the plugin temporarily** in your config:

   ```json
   {
     "plugins": {
       "slots": {
         "memory": "memory-core" // or "none"
       }
     }
   }
   ```

2. **Check logs** for specific error messages from the Python bridge

3. **Test the bridge directly**:

   ```bash
   python3 extensions/memory-cognee/bridge.py search "test" 5
   ```

4. **Verify Cognee installation**:
   ```bash
   python3 -c "import cognee; print('OK')"
   ```

## References

- [Cognee GitHub](https://github.com/topoteretes/cognee)
- [Cognee Documentation](https://www.cognee.ai)
