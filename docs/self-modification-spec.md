# Specification: Self-Modification Integration

This spec defines the tools, states, and logic required to integrate autonomous code improvement into the OpenClaw framework.

## 1. New AI Network Nodes (Layer 3)

We extend the AI Network (FSM) with nodes dedicated to self-improvement.

1.  **`NODE_DIAGNOSTIC`**: Active when `tool_error_rate` exceeds threshold. Tasks:
    - Retrieve failing session logs via `sessions_history`.
    - Map failures to source lines.
2.  **`NODE_MUTATION`**: Active during code editing.
    - Generates diffs for `src/*.ts`.
    - Triggers `pnpm build` to verify syntax.
3.  **`NODE_VERIFICATION`**: Active during Dojo testing.
    - Executes `pnpm test`.
    - Validates `successCriteria` for the specific Dojo task.

---

## 2. The `Mutator` Toolset

We need specialized tools for agents working on their own codebase.

### 2.1 `evolution_propose_patch`

A wrapper around `apply_patch` that includes metadata for the evolution system.

- **Input**: `patch` (diff string), `rationale` (text), `target_genotype_id` (string).
- **Action**: Writes patch to `~/.openclaw/evolution/patches/pending/`.

### 2.2 `evolution_run_dojo_test`

Trigger a Dojo task execution for a specific code version.

- **Input**: `taskId`, `genotypeId`.
- **Action**: Spawns a sandbox, applies the code change, runs the task, returns `RunStats`.

---

## 3. Integration into `Breeder`

Update `src/agents/evolution/breeder.ts` to include code mutation logic.

```typescript
export class Breeder {
  // ... existing logic ...

  async runMutationCycle() {
    const hotspots = await this.identifyHotspots();
    for (const hotspot of hotspots) {
      const engineer = await this.spawnEngineer(hotspot);
      const patch = await engineer.proposeFix();

      const success = await this.validateInDojo(patch, hotspot.task);
      if (success) {
        await this.commitAndNotify(patch);
      }
    }
  }
}
```

---

## 4. Safety Guardrails

### 4.1 File Access Policy

The evolution system is restricted by a `self-modification-policy.json`:

- **Allowed**: `src/agents/tools/*.ts`, `src/utils/*.ts`.
- **Blocked**: `src/agents/security/*`, `package.json` (except dependencies), `.env`.

### 4.2 Reversion Hook

If the Gateway detects a crash loop immediately after a self-patch:

1.  Intercept `SIGABRT` or `Process Exit (1)`.
2.  Restore the previous stable build from `dist/stable_backup`.
3.  Flag the genotype/patch as "Lethal" in `stats.jsonl`.

---

## 5. Implementation Roadmap

1.  **Step 1**: Implement `NODE_DIAGNOSTIC` in FSM.
2.  **Step 2**: Create the `self-modification-policy.json` and tool restriction logic.
3.  **Step 3**: Implement `evolution_run_dojo_test` using real sandboxing (Docker).
4.  **Step 4**: Enable the `Breeder` to trigger a `MutationCycle` based on aggregated telemetry.
