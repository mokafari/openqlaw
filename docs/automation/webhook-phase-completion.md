---
summary: "Webhook configuration for phase/task completion notifications"
read_when:
  - Setting up webhook notifications for sub-agents or background tasks
  - Configuring phase completion webhooks
title: "Phase Completion Webhooks"
---

# Phase Completion Webhooks

Sub-agents and background tasks can notify the main agent when phases or tasks complete via webhooks.

## Configuration

Enable hooks in your config and add mappings for phase completion. Since path matching is exact, you have two options:

### Option 1: Source-Based Routing (Recommended for General Use)

Use `match.source` to route based on payload content rather than path:

```json5
{
  hooks: {
    enabled: true,
    token: "your-secret-token-here",
    path: "/hooks",
    mappings: [
      {
        // Matches any path if payload includes source: "phase-completion"
        match: { source: "phase-completion" },
        action: "wake",
        wakeMode: "now",
        name: "Phase Complete",
        textTemplate: "Phase completion: {{payload.phase || payload.message || 'Task done'}}",
      },
    ],
  },
}
```

Then send webhooks with `source` in the payload:

```bash
curl -X POST http://127.0.0.1:18789/hooks/djs3/phase7-done \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"source": "phase-completion", "phase": "phase7", "message": "Phase 7 complete"}'
```

### Option 2: Exact Path Matching

Create mappings for specific paths:

```json5
{
  hooks: {
    enabled: true,
    token: "your-secret-token-here",
    path: "/hooks",
    mappings: [
      {
        match: { path: "djs3/phase7-done" },
        action: "wake",
        wakeMode: "now",
        name: "Phase 7 Complete",
        textTemplate: "Phase 7 complete: {{payload.message || 'Task done'}}",
      },
      {
        match: { path: "djs3/phase1-done" },
        action: "wake",
        wakeMode: "now",
        name: "Phase 1 Complete",
        textTemplate: "Phase 1 complete: {{payload.message || 'Task done'}}",
      },
      // Add more mappings for other phases as needed
    ],
  },
}
```

## Usage in Sub-Agents

Sub-agents should use the correct gateway port (default: 18789) when constructing webhook URLs:

### Option 1: Use the built-in `/hooks/wake` endpoint

```bash
curl -X POST http://127.0.0.1:18789/hooks/wake \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"text": "Phase 7 complete", "mode": "now"}'
```

### Option 2: Use a custom mapped path

```bash
curl -X POST http://127.0.0.1:18789/hooks/djs3/phase7-done \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"message": "Phase 7 complete", "phase": "phase7"}'
```

## Getting the Gateway Port and Webhook URL

The gateway port can be:

- Default: `18789`
- From config: `gateway.port`
- From environment: `OPENCLAW_GATEWAY_PORT` or `CLAWDBOT_GATEWAY_PORT`

### For Sub-Agents (TypeScript/JavaScript)

Use the webhook URL utility:

```typescript
import { buildWebhookUrl, getGatewayPort } from "openclaw/hooks/gmail";

// Get the correct webhook URL
const webhookUrl = buildWebhookUrl("djs3/phase7-done");
// Returns: "http://127.0.0.1:18789/hooks/djs3/phase7-done"

// Or get just the port
const port = getGatewayPort();
// Returns: 18789 (or configured port)
```

### For Shell Scripts

```bash
# Get port from config (requires jq)
PORT=$(openclaw config get gateway.port 2>/dev/null || echo "18789")

# Or use environment variable
PORT=${OPENCLAW_GATEWAY_PORT:-18789}

# Construct webhook URL
WEBHOOK_URL="http://127.0.0.1:${PORT}/hooks/djs3/phase7-done"
```

## Pattern Matching

Path matching is **exact** - no wildcards supported. Options:

1. **Source-based routing** (recommended): Use `match.source` to match on payload content
2. **Multiple exact paths**: Create separate mappings for each path you need
3. **Transform function**: Use a custom transform module for complex pattern matching

## Quick Setup

1. **Enable hooks in config** (`~/.openclaw/openclaw.json`):

```json5
{
  hooks: {
    enabled: true,
    token: "your-secret-token-here",
    path: "/hooks",
    mappings: [
      {
        match: { source: "phase-completion" },
        action: "wake",
        wakeMode: "now",
        name: "Phase Complete",
        textTemplate: "Phase completion: {{payload.phase || payload.message || 'Task done'}}",
      },
    ],
  },
}
```

2. **Generate a secure token**:

```bash
openssl rand -hex 24
```

3. **Use the correct port** (default: 18789, not 3033):

```bash
curl -X POST http://127.0.0.1:18789/hooks/djs3/phase7-done \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"source": "phase-completion", "phase": "phase7", "message": "Phase 7 complete"}'
```

## Security

- Always use the `Authorization: Bearer <token>` header
- Never hardcode tokens in agent-generated code
- Keep hook tokens separate from gateway auth tokens
- Generate tokens with: `openssl rand -hex 24`
