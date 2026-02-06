import { isDevMode, isProjectSelfEdit, saveDevContinuation } from "./dev-continuation.js";

/** File-writing shell patterns that target project source. */
const SHELL_WRITE_PATTERNS = [
  /\bsed\s+-i/,
  /\bcat\s+>\s*/,
  /\becho\s+.*>\s*/,
  /\btee\s+/,
  />\s*['"]?(?:src|scripts)\//,
];

function extractFilePathFromExecCommand(command: string): string | null {
  for (const pattern of SHELL_WRITE_PATTERNS) {
    if (pattern.test(command)) {
      // Try to extract the target path — best-effort heuristic
      const pathMatch = command.match(/(?:src|scripts)\/\S+/);
      return pathMatch ? pathMatch[0] : null;
    }
  }
  return null;
}

type ToolCallInfo = {
  toolName: string;
  params: Record<string, unknown>;
  toolCallId?: string;
  sessionKey?: string;
};

/** Non-blocking: checks if a tool call is a self-edit and saves a continuation snapshot. */
export function maybeSnapshotDevContinuation(info: ToolCallInfo): void {
  if (!isDevMode()) {
    return;
  }

  let editedFile: string | null = null;
  const name = info.toolName.toLowerCase();

  if (name === "write" || name === "edit" || name === "file_write") {
    const filePath =
      (info.params.file_path as string) ??
      (info.params.filePath as string) ??
      (info.params.path as string);
    if (typeof filePath === "string" && isProjectSelfEdit(filePath)) {
      editedFile = filePath;
    }
  } else if (name === "exec" || name === "bash") {
    const command = (info.params.command as string) ?? "";
    if (typeof command === "string") {
      const target = extractFilePathFromExecCommand(command);
      if (target && isProjectSelfEdit(target)) {
        editedFile = target;
      }
    }
  }

  if (!editedFile) {
    return;
  }

  // Fire-and-forget — never block the tool call
  saveDevContinuation({
    sessionKey: info.sessionKey,
    editedFile,
    taskSummary: `Editing ${editedFile} via ${info.toolName} tool`,
    toolCallId: info.toolCallId,
  }).catch(() => {});
}
