# Self-Update Fixes Needed

## Critical Issues

### 1. `spawnDiagnosticAgent` doesn't extract real patches

**Location:** `src/agents/evolution/mutator.ts:151-203`

**Problem:** Returns placeholder `proposedFix: undefined` instead of extracting patches from agent tool calls.

**Fix:** Need to:

- Get session history after agent completes
- Find `apply_patch` or `evolution_propose_patch` tool calls
- Extract patch content from tool results
- Return actual patch path or content

### 2. Mutation workflow doesn't apply patches

**Location:** `src/agents/evolution/mutation-workflow.ts:78-80`

**Problem:** Line 80 says "In real implementation, this would trigger a git commit" - patches are validated but never applied.

**Fix:** After Dojo validation passes:

- Call `applyPatchToCodebase` from `src/agents/evolution/patches.ts`
- Use `rebuild_gateway` tool to rebuild
- Optionally commit via git if in repo

### 3. No rebuild trigger after mutations

**Problem:** Even if patches were applied, there's no automatic rebuild.

**Fix:** After successful patch application:

- Call `rebuild_gateway` tool via gateway
- Wait for build to complete
- Verify build succeeded before marking mutation as complete

## Implementation Plan

1. **Fix `spawnDiagnosticAgent`:**
   - Use `sessions_history` to get tool calls from diagnostic agent session
   - Parse `apply_patch` or `evolution_propose_patch` tool results
   - Extract patch content and return it

2. **Fix `mutation-workflow.ts`:**
   - After Dojo validation, actually apply the patch
   - Trigger rebuild via `rebuild_gateway` tool
   - Handle errors and rollback if needed

3. **Add git commit support (optional):**
   - If in git repo, commit successful mutations
   - Include mutation metadata in commit message
