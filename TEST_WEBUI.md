# Testing Web UI After Fix

## Quick Test Steps

1. **Open the Web UI** (should already be open at http://127.0.0.1:18789/)

2. **Check Connection Status**
   - Look at the top of the page for connection status
   - Should show "Connected" (green indicator)
   - If it shows "Disconnected", check the browser console for errors

3. **Send a Test Message**
   - Type a simple message like: "Hello, can you respond?"
   - Press Enter or click Send
   - Wait for a response (should appear within 5-10 seconds)

4. **What to Look For**
   - ✅ **Success**: You see your message appear, then an assistant response appears
   - ❌ **Still Broken**: Message appears but no response, or connection drops

## If Still Not Working

### Check Browser Console

1. Open DevTools (F12 or Cmd+Option+I)
2. Go to Console tab
3. Look for errors like:
   - WebSocket connection errors
   - "event gap detected"
   - "disconnected" messages
   - Memory plugin errors

### Check Gateway Logs

The terminal where the gateway is running should show:

- Message received logs
- Agent execution logs
- Any error messages

### Verify the Fix

The fix adds a 5-second timeout to memory-cognee's `before_agent_start` hook. This means:

- If memory search takes > 5 seconds, it's skipped (agent continues)
- Agent should start within 5 seconds even if memory plugin has issues

## Expected Behavior

**Before Fix:**

- Message sent → Agent hangs waiting for memory search → No response

**After Fix:**

- Message sent → Memory search times out after 5s (if slow) → Agent starts → Response appears

## If You See Errors

Common issues and fixes:

1. **"pairing required"**

   ```bash
   openclaw devices list
   openclaw devices approve <requestId>
   ```

2. **WebSocket connection failed**
   - Check gateway is running: `pnpm openclaw gateway status`
   - Check firewall isn't blocking port 18789

3. **Memory plugin errors in console**
   - Temporarily disable: Set `plugins.slots.memory` to `"none"` in config
   - Restart gateway

4. **Still no responses after 10 seconds**
   - Check gateway logs for agent execution errors
   - Try disabling memory plugin completely
   - Check if agent/model credentials are configured
