import path from "node:path";
import type { DevSelfEditContinuation } from "./restart-sentinel.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveOpenClawPackageRootSync } from "./openclaw-root.js";
import { writeRestartSentinel } from "./restart-sentinel.js";

const log = createSubsystemLogger("dev-continuation");

/** True when running under watch-node.mjs dev server. */
export function isDevMode(): boolean {
  return process.env.OPENCLAW_DEV_WATCH === "1";
}

let projectRoot: string | null | undefined;

function getProjectRoot(): string | null {
  if (projectRoot === undefined) {
    projectRoot = resolveOpenClawPackageRootSync({ cwd: process.cwd() });
  }
  return projectRoot;
}

const SELF_EDIT_DIRS = ["src", "scripts"];

/** Check if a file path is inside the running project's source directories. */
export function isProjectSelfEdit(filePath: string): boolean {
  const root = getProjectRoot();
  if (!root) {
    return false;
  }
  const resolved = path.resolve(filePath);
  return SELF_EDIT_DIRS.some((dir) => resolved.startsWith(path.join(root, dir) + path.sep));
}

export type DevContinuationContext = {
  sessionKey?: string;
  editedFile: string;
  taskSummary: string;
  toolCallId?: string;
};

/** Write a restart sentinel with dev-self-edit continuation info. */
export async function saveDevContinuation(context: DevContinuationContext): Promise<void> {
  if (!isDevMode()) {
    return;
  }
  const continuation: DevSelfEditContinuation = {
    editedFile: context.editedFile,
    taskSummary: context.taskSummary,
    toolCallId: context.toolCallId,
  };
  try {
    await writeRestartSentinel({
      kind: "dev-self-edit",
      status: "ok",
      ts: Date.now(),
      sessionKey: context.sessionKey,
      continuation,
    });
    log.debug(`Self-edit continuation saved for ${context.editedFile}`);
  } catch (err) {
    log.warn(`Failed to save dev continuation: ${String(err)}`);
  }
}
