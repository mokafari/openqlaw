# Self-Update System - Implementation Status

## ✅ Fixed (2026-02-07)

### 1. spawnDiagnosticAgent Now Extracts Real Patches

**Commit:** `626feed3f`

The diagnostic agent spawning now:

- Waits for agent completion using `agent.wait`
- Reads session history to find tool calls
- Extracts patches from `apply_patch`, `edit`, or `evolution_propose_patch` tools
- Converts edit operations to patch format

```typescript
// Now properly waits and extracts
const waitResult = await callGateway({
  method: "agent.wait",
  params: { runId, timeoutMs: 300_000 },
});
const patchResult = await this.extractPatchFromSession(childSessionKey);
```

### 2. Mutation Workflow Now Applies Patches

**Commit:** `626feed3f`

Full cycle implemented:

1. **Save patch** → `savePatch()` stores the patch with metadata
2. **Dojo verification** → Validates the patch works
3. **Apply patch** → `applyPatchToCodebase()` modifies files
4. **Build verification** → Runs `pnpm build` to verify
5. **Auto-revert** → Reverts if build fails
6. **Git commit** → Commits with auto-generated message
7. **Gateway restart** → Triggers restart to apply changes

### 3. Rebuild Trigger Added

**Commit:** `626feed3f`

After successful patch application:

```typescript
await callGateway({
  method: "restart",
  params: { reason: "self-evolution: applied mutation" },
});
```

## Architecture

```
┌─────────────────┐
│  identifyHotspots()
│  - Scans telemetry for high error rates
└────────┬────────┘
         ▼
┌─────────────────┐
│  spawnDiagnosticAgent()
│  - Spawns sub-agent with diagnostic prompt
│  - Waits for completion (agent.wait)
│  - Extracts patches from tool calls
└────────┬────────┘
         ▼
┌─────────────────┐
│  validatePatch()
│  - Policy guard check
│  - File path allowlist
└────────┬────────┘
         ▼
┌─────────────────┐
│  runEvolutionDojoTask()
│  - Dojo verification suite
│  - Fitness scoring
└────────┬────────┘
         ▼
┌─────────────────┐
│  applyPatchToCodebase()
│  - Actually modifies files
│  - Creates backup first
└────────┬────────┘
         ▼
┌─────────────────┐
│  verifyBuild()
│  - Runs pnpm build
│  - Reverts on failure
└────────┬────────┘
         ▼
┌─────────────────┐
│  commitChange()
│  - Git add + commit
│  - Auto-generated message
└────────┬────────┘
         ▼
┌─────────────────┐
│  triggerRestart()
│  - Gateway restart
│  - Applies new code
└─────────────────┘
```

## Testing

To trigger a self-update cycle manually:

```typescript
import { Mutator } from "./mutator.js";
import { MutationWorkflow } from "./mutation-workflow.js";

const mutator = new Mutator({ workspaceDir: "/path/to/openclaw" });
const workflow = new MutationWorkflow(mutator, "/path/to/openclaw");

const results = await workflow.run();
console.log(results);
```

Or via cron job (already configured):

- Self-Healing Cycle runs every hour
- Checks for hotspots and system failures
- Automatically applies fixes

## Configuration

In `openclaw.json`:

```json
{
  "tools": {
    "evolution": {
      "selfModification": {
        "enabled": true,
        "autoTrigger": true
      },
      "autoRecovery": {
        "enabled": true,
        "maxRetries": 3,
        "agent": "claude-code"
      }
    }
  }
}
```
