# Web UI Debugging Guide

## Issue: No answers through web UI

### Quick Checks

1. **Check Gateway Status**

   ```bash
   pnpm openclaw gateway status
   ```

   Verify the gateway is running and listening on the expected port.

2. **Check Browser Console**
   - Open browser DevTools (F12)
   - Check Console tab for WebSocket errors
   - Check Network tab for failed WebSocket connections
   - Look for errors like "WebSocket connection failed" or "event gap detected"

3. **Check Gateway Logs**

   ```bash
   # If running via macOS app, check logs:
   ./scripts/clawlog.sh

   # Or check gateway output directly if running via CLI
   ```

4. **Verify WebSocket Connection**
   - In browser console, check if `host.connected` is `true`
   - Look for "hello" event in the event log
   - Check for "disconnected" errors

### Common Issues

#### 1. Memory Plugin Blocking

The `memory-cognee` plugin's `before_agent_start` hook could be hanging if:

- Python bridge script is failing
- LLM_API_KEY is missing or invalid
- Bridge operation times out (60s timeout)

**Solution:**

```bash
# Temporarily disable memory-cognee
# Edit ~/.openclaw/openclaw.json:
{
  "plugins": {
    "slots": {
      "memory": "memory-core"  # or "none"
    },
    "entries": {
      "memory-cognee": {
        "enabled": false
      }
    }
  }
}
```

Then restart the gateway.

#### 2. Agent Not Starting

If `agentRunStarted` stays `false`, the agent isn't being invoked. Check:

- Agent configuration is valid
- Model/provider credentials are set
- No errors in gateway logs during dispatch

#### 3. Events Not Broadcasting

If agent runs but events don't reach the UI:

- Check WebSocket connection is active
- Verify `broadcast("chat", ...)` is being called
- Check for "slow consumer" disconnections

#### 4. WebSocket Connection Issues

- Check gateway URL in UI settings matches actual gateway
- Verify token/password if authentication is enabled
- Check firewall/network blocking WebSocket connections

### Debugging Steps

1. **Test with minimal config:**

   ```json
   {
     "plugins": {
       "slots": {
         "memory": "none"
       }
     }
   }
   ```

2. **Check agent events in browser:**
   - Open DevTools → Network → WS tab
   - Filter for WebSocket connection
   - Look for "chat" events with state "delta" or "final"

3. **Enable verbose logging:**

   ```bash
   OPENCLAW_VERBOSE=1 pnpm openclaw gateway run
   ```

4. **Test direct agent command:**
   ```bash
   pnpm openclaw agent --message "test" --session-key "test:webchat"
   ```
   This bypasses the web UI and tests if the agent works at all.

### Code Flow to Check

1. **Message Send:** `ui/src/ui/controllers/chat.ts` → `sendChatMessage()`
2. **Gateway Handler:** `src/gateway/server-methods/chat.ts` → `chat.send`
3. **Agent Dispatch:** `src/auto-reply/dispatch.ts` → `dispatchInboundMessage()`
4. **Event Broadcasting:** `src/gateway/server-chat.ts` → `createAgentEventHandler()`
5. **UI Event Handling:** `ui/src/ui/app-gateway.ts` → `handleGatewayEvent()`

### Specific Checks for memory-cognee

If using memory-cognee, verify:

```bash
# Test Python bridge directly
export LLM_API_KEY="your-key"
python3 extensions/memory-cognee/bridge.py search "test" 5

# Check for Python errors
python3 -c "import cognee" 2>&1

# Verify bridge timeout (should complete in < 60s)
time python3 extensions/memory-cognee/bridge.py search "test" 3
```

If bridge hangs or errors, the `before_agent_start` hook will block agent execution.
