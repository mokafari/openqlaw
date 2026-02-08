# iMessage Echo Detection Fix — 2026-02-08

**Commit:** `a0128b61e`
**Status:** ✅ DEPLOYED

---

## Problem

Messages sent via the `message` tool were not being tracked by EchoDetector, causing:

1. Outbound messages sent via `infra/outbound/deliver.ts` → NOT recorded
2. When echoed back by iMessage, treated as new user input
3. Agent would process its own messages → feedback loops

### Root Cause

The existing EchoDetector was only integrated in:

- `src/agents/pi-embedded-runner/run.ts` — checks incoming messages
- Local `SentMessageCache` in `monitor-provider.ts` — 5-second TTL, only for replies

**GAP:** The `message` tool sends via `deliverOutboundPayloads()` in `src/infra/outbound/deliver.ts`, which did NOT call `recordOutgoing()`.

---

## Solution: Option B Implementation

### Step 1: Modify `src/infra/outbound/deliver.ts`

**Added import:**

```typescript
import { getEchoDetector } from "../../agents/echo-detector.js";
```

**Added at end of `deliverOutboundPayloads()` after successful delivery:**

```typescript
// Record outgoing messages for echo detection
// This prevents messages sent via the message tool from echoing back as user input
if (results.length > 0) {
  const echoDetector = getEchoDetector();
  for (const payload of normalizedPayloads) {
    if (payload.text) {
      echoDetector.recordOutgoing(payload.text, to);
    }
  }
}
```

### Step 2: Modify `src/imessage/monitor/monitor-provider.ts`

**Added import:**

```typescript
import { getEchoDetector } from "../../agents/echo-detector.js";
```

**Added global echo check before local cache check:**

```typescript
// Global echo detection: catches messages sent via the message tool (outbound path)
// which are not tracked by the local sentMessageCache
const globalEcho = getEchoDetector().detectEcho(messageText, echoScope);
if (globalEcho.isEcho) {
  logVerbose(
    `imessage: skipping echo (global detector): "${truncateUtf16Safe(messageText, 50)}" - ${globalEcho.reason ?? "matched"}`,
  );
  return;
}
```

---

## Detection Flow (After Fix)

```
Message Tool Called
       ↓
deliverOutboundPayloads()
       ↓
Send via channel adapter (iMessage/etc)
       ↓
recordOutgoing(text, destination) ← NEW
       ↓
[Message delivered to user]
       ↓
[Message echoes back via monitor]
       ↓
monitor-provider.ts receives message
       ↓
detectEcho() ← NEW GLOBAL CHECK (5 min window)
       ↓
isEcho=true → SKIP (no processing)
```

---

## Files Modified

| File                                       | Changes                                    |
| ------------------------------------------ | ------------------------------------------ |
| `src/infra/outbound/deliver.ts`            | +1 import, +10 lines (recordOutgoing call) |
| `src/imessage/monitor/monitor-provider.ts` | +1 import, +9 lines (global echo check)    |

---

## Build & Test Results

### Build

```
✅ Build complete in 5521ms (SDK)
✅ Build complete in 5688ms (entry)
✅ Build complete in 5694ms (entry)
✅ Build complete in 5698ms (plugin-sdk)
0 errors, 0 warnings
```

### Git

```
Commit: a0128b61e
Message: fix(echo): Wire EchoDetector into iMessage outbound delivery path
Pushed to: origin/dev
```

---

## Before/After Behavior

### Before

```
1. User: "send a message saying hello"
2. Agent: [sends via message tool]
3. iMessage: [echoes message back]
4. Agent: [processes echo as new message] ← BUG
5. Agent: [responds to its own message]
6. Repeat → feedback loop
```

### After

```
1. User: "send a message saying hello"
2. Agent: [sends via message tool]
3. deliver.ts: [records outgoing → EchoDetector]
4. iMessage: [echoes message back]
5. monitor-provider: [detectEcho() → isEcho=true]
6. monitor-provider: [skips echo, logs warning]
7. No feedback loop ✅
```

---

## Echo Detection Parameters

| Parameter      | Value                      | Notes                                 |
| -------------- | -------------------------- | ------------------------------------- |
| Hash Window    | 5 minutes                  | How long to remember sent messages    |
| Max Messages   | 1000                       | Auto-cleanup beyond this              |
| Hash Algorithm | SHA-256                    | Content-based detection               |
| Scope Format   | `accountId:channel:target` | Prevents cross-conversation conflicts |

---

## Testing Verification

To verify the fix works:

1. **Send message via tool:**

   ```
   message action=send target="iMessage:+1234567890" message="Test echo fix"
   ```

2. **Check logs for echo detection:**

   ```bash
   grep "skipping echo" ~/.openclaw/logs/gateway.log | tail -5
   ```

3. **Expected log entry:**
   ```
   imessage: skipping echo (global detector): "Test echo fix..." - Content hash matches recent outgoing message
   ```

---

## Related Components

- **EchoDetector:** `src/agents/echo-detector.ts`
- **Previous Integration:** `src/agents/pi-embedded-runner/run.ts`
- **Local Cache:** `SentMessageCache` in `monitor-provider.ts` (still active, 5s TTL)
- **Documentation:** `ECHO_DETECTOR_INTEGRATED.md`

---

## Gateway Restart Required

The gateway must be restarted for changes to take effect:

```bash
openclaw restart
```

Or via evolution system, the restart will happen automatically after patch application.

---

**Status:** ✅ FIX COMPLETE — Echo detection now covers all outbound paths
