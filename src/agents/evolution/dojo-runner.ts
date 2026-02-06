import fs from "node:fs/promises";
import path from "node:path";
import type { DojoTask } from "./dojo.js";
import type { RunStats } from "./telemetry.js";
import { DEFAULT_SANDBOX_IMAGE } from "../sandbox/constants.js";
import { execDocker, ensureDockerImage } from "../sandbox/docker.js";

export async function runEvolutionDojoTask(params: {
  task: DojoTask;
  genotypeId: string;
  patchPath?: string;
  workspaceRoot: string;
}): Promise<RunStats> {
  const containerName = `openclaw-dojo-${params.task.id}-${Date.now()}`;
  const sandboxDir = path.join(params.workspaceRoot, "dojo", params.task.id);
  await fs.mkdir(sandboxDir, { recursive: true });

  // 1. Prepare Sandbox
  await ensureDockerImage(DEFAULT_SANDBOX_IMAGE);

  // 2. Propose a "Breeder" workflow for the container
  // Create the container with the workspace mounted
  await execDocker([
    "run",
    "-d",
    "--name",
    containerName,
    "-v",
    `${sandboxDir}:/workspace`,
    "--workdir",
    "/workspace",
    DEFAULT_SANDBOX_IMAGE,
    "sleep",
    "infinity",
  ]);

  const started = Date.now();
  let success = false;
  let error: string | undefined;

  try {
    // 3. Apply Patch if provided
    if (params.patchPath) {
      const patchContent = await fs.readFile(params.patchPath, "utf-8");
      // Use a temporary file inside the container to apply the patch
      const containerPatchPath = "/tmp/mutation.patch";
      await execDocker(["cp", params.patchPath, `${containerName}:${containerPatchPath}`]);
      await execDocker(["exec", containerName, "patch", "-p1", "-i", containerPatchPath]);
    }

    // 4. Run Task Prompt (Simulated for spec, in reality calls Agent)
    // For Phase 3, we execute the 'commandsSucceed' from successCriteria
    if (params.task.successCriteria?.commandsSucceed) {
      for (const cmd of params.task.successCriteria.commandsSucceed) {
        const result = await execDocker(["exec", containerName, "sh", "-c", cmd], {
          allowFailure: true,
        });
        if (result.code !== 0) {
          throw new Error(`Command failed: ${cmd}
${result.stderr}`);
        }
      }
    }

    success = true;
  } catch (err) {
    success = false;
    error = err instanceof Error ? err.message : String(err);
  } finally {
    // Cleanup
    await execDocker(["rm", "-f", containerName], { allowFailure: true });
  }

  return {
    sessionId: containerName,
    timestamp: Date.now(),
    success,
    error,
    durationMs: Date.now() - started,
    tokenUsage: { input: 0, output: 0, total: 0 }, // Would be populated by agent run
    toolCalls: 0,
    genotypeId: params.genotypeId,
  };
}
