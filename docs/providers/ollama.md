---
summary: "Run OpenClaw with Ollama (local LLM runtime)"
read_when:
  - You want to run OpenClaw with local models via Ollama
  - You need Ollama setup and configuration guidance
title: "Ollama"
---

# Ollama

Ollama is a local LLM runtime that makes it easy to run open-source models on your machine. OpenClaw integrates with Ollama's OpenAI-compatible API and can **auto-discover tool-capable models** when you opt in with `OLLAMA_API_KEY` (or an auth profile) and do not define an explicit `models.providers.ollama` entry.

## Quick start

1. Install Ollama: https://ollama.ai

2. Pull a model:

```bash
ollama pull llama3.3
# or
ollama pull qwen2.5-coder:32b
# or
ollama pull deepseek-r1:32b
```

3. Enable Ollama for OpenClaw (any value works; Ollama doesn't require a real key):

```bash
# Set environment variable
export OLLAMA_API_KEY="ollama-local"

# Or configure in your config file
openclaw config set models.providers.ollama.apiKey "ollama-local"
```

4. Use Ollama models:

```json5
{
  agents: {
    defaults: {
      model: { primary: "ollama/llama3.3" },
    },
  },
}
```

## Model discovery (implicit provider)

When you set `OLLAMA_API_KEY` (or an auth profile) and **do not** define `models.providers.ollama`, OpenClaw discovers models from the local Ollama instance at `http://127.0.0.1:11434`:

- Queries `/api/tags` and `/api/show`
- Keeps only models that report `tools` capability
- Marks `reasoning` when the model reports `thinking`
- Reads `contextWindow` from `model_info["<arch>.context_length"]` when available
- Sets `maxTokens` to 10× the context window
- Sets all costs to `0`

This avoids manual model entries while keeping the catalog aligned with Ollama's capabilities.

To see what models are available:

```bash
ollama list
openclaw models list
```

To add a new model, simply pull it with Ollama:

```bash
ollama pull mistral
```

The new model will be automatically discovered and available to use.

If you set `models.providers.ollama` explicitly, auto-discovery is skipped and you must define models manually (see below).

## Configuration

### Basic setup (implicit discovery)

The simplest way to enable Ollama is via environment variable:

```bash
export OLLAMA_API_KEY="ollama-local"
```

### Explicit setup (manual models)

Use explicit config when:

- Ollama runs on another host/port.
- You want to force specific context windows or model lists.
- You want to include models that do not report tool support.

```json5
{
  models: {
    providers: {
      ollama: {
        // Use a host that includes /v1 for OpenAI-compatible APIs
        baseUrl: "http://ollama-host:11434/v1",
        apiKey: "ollama-local",
        api: "openai-completions",
        models: [
          {
            id: "llama3.3",
            name: "Llama 3.3",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 8192,
            maxTokens: 8192 * 10
          }
        ]
      }
    }
  }
}
```

If `OLLAMA_API_KEY` is set, you can omit `apiKey` in the provider entry and OpenClaw will fill it for availability checks.

### Custom base URL (explicit config)

If Ollama is running on a different host or port (explicit config disables auto-discovery, so define models manually):

```json5
{
  models: {
    providers: {
      ollama: {
        apiKey: "ollama-local",
        baseUrl: "http://ollama-host:11434/v1",
      },
    },
  },
}
```

### Model selection

Once configured, all your Ollama models are available:

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "ollama/llama3.3",
        fallback: ["ollama/qwen2.5-coder:32b"],
      },
    },
  },
}
```

### Automatic fallback

OpenClaw can automatically add Ollama to your fallback chain when it's available. This provides a free, local backup when your primary provider fails (rate limits, timeouts, etc.).

**Default behavior** (enabled by default):

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "anthropic/claude-opus-4-5",
        // Ollama automatically added as last fallback when available
      },
      ollamaFallback: {
        enabled: true, // Enable automatic Ollama fallback
        autoAdd: true, // Automatically add to fallbacks
        priority: -1, // Position: -1 = last (default), 0 = first, positive = index
      },
    },
  },
}
```

**Disable auto-add** (use manual fallbacks only):

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "anthropic/claude-opus-4-5",
        fallbacks: ["ollama/llama3.3"], // Manual placement
      },
      ollamaFallback: {
        enabled: true,
        autoAdd: false, // Don't auto-add, use manual fallbacks
      },
    },
  },
}
```

**Priority options**:

- `-1` (default): Append Ollama to the end of the fallback chain (safest)
- `0`: Prepend Ollama right after the primary model (most aggressive)
- Positive number: Insert at specific index (e.g., `2` = third position)

### Cost-aware routing

Use Ollama for low-complexity tasks to save on API costs. When enabled, OpenClaw analyzes task complexity and routes simple tasks to Ollama automatically.

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "anthropic/claude-opus-4-5",
      },
      ollamaFallback: {
        enabled: true,
        autoAdd: true,
      },
      costAwareRouting: {
        enabled: true,
        ollamaThreshold: 0.3, // Use Ollama for tasks < 30% complexity
      },
    },
  },
}
```

**How it works**:

- Analyzes prompt text for complexity indicators (length, keywords, tool usage)
- If complexity < threshold AND Ollama is available → routes to Ollama
- Otherwise → uses primary model
- Falls back to primary model if Ollama becomes unavailable

**Complexity analysis**:

- Simple tasks (lower complexity): "what time is it", "list files", "show status"
- Complex tasks (higher complexity): "refactor architecture", "implement new system", "debug complex issue"

Adjust `ollamaThreshold` (0.0-1.0) to control when Ollama is used:

- `0.1`: Only very simple tasks
- `0.3`: Simple to moderate tasks (default)
- `0.5`: Most tasks except complex ones

## Advanced

### Reasoning models

OpenClaw marks models as reasoning-capable when Ollama reports `thinking` in `/api/show`:

```bash
ollama pull deepseek-r1:32b
```

### Model Costs

Ollama is free and runs locally, so all model costs are set to $0.

### Context windows

For auto-discovered models, OpenClaw uses the context window reported by Ollama when available, otherwise it defaults to `8192`. You can override `contextWindow` and `maxTokens` in explicit provider config.

## Troubleshooting

### Ollama not detected

Make sure Ollama is running and that you set `OLLAMA_API_KEY` (or an auth profile), and that you did **not** define an explicit `models.providers.ollama` entry:

```bash
ollama serve
```

And that the API is accessible:

```bash
curl http://localhost:11434/api/tags
```

### No models available

OpenClaw only auto-discovers models that report tool support. If your model isn't listed, either:

- Pull a tool-capable model, or
- Define the model explicitly in `models.providers.ollama`.

To add models:

```bash
ollama list  # See what's installed
ollama pull llama3.3  # Pull a model
```

### Connection refused

Check that Ollama is running on the correct port:

```bash
# Check if Ollama is running
ps aux | grep ollama

# Or restart Ollama
ollama serve
```

## See Also

- [Model Providers](/concepts/model-providers) - Overview of all providers
- [Model Selection](/concepts/models) - How to choose models
- [Configuration](/gateway/configuration) - Full config reference
