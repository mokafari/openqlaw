import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { createEditTool, createReadTool, createWriteTool } from "@mariozechner/pi-coding-agent";
import { readFile, stat } from "fs/promises";
import { resolve as pathResolve } from "path";
import type { AnyAgentTool } from "./pi-tools.types.js";
import { detectMime } from "../media/mime.js";
import { assertSandboxPath } from "./sandbox-paths.js";
import { sanitizeToolResultImages } from "./tool-images.js";

// NOTE(steipete): Upstream read now does file-magic MIME detection; we keep the wrapper
// to normalize payloads and sanitize oversized images before they hit providers.
type ToolContentBlock = AgentToolResult<unknown>["content"][number];
type ImageContentBlock = Extract<ToolContentBlock, { type: "image" }>;
type TextContentBlock = Extract<ToolContentBlock, { type: "text" }>;

async function sniffMimeFromBase64(base64: string): Promise<string | undefined> {
  const trimmed = base64.trim();
  if (!trimmed) {
    return undefined;
  }

  const take = Math.min(256, trimmed.length);
  const sliceLen = take - (take % 4);
  if (sliceLen < 8) {
    return undefined;
  }

  try {
    const head = Buffer.from(trimmed.slice(0, sliceLen), "base64");
    return await detectMime({ buffer: head });
  } catch {
    return undefined;
  }
}

function rewriteReadImageHeader(text: string, mimeType: string): string {
  // pi-coding-agent uses: "Read image file [image/png]"
  if (text.startsWith("Read image file [") && text.endsWith("]")) {
    return `Read image file [${mimeType}]`;
  }
  return text;
}

async function normalizeReadImageResult(
  result: AgentToolResult<unknown>,
  filePath: string,
): Promise<AgentToolResult<unknown>> {
  const content = Array.isArray(result.content) ? result.content : [];

  const image = content.find(
    (b): b is ImageContentBlock =>
      !!b &&
      typeof b === "object" &&
      (b as { type?: unknown }).type === "image" &&
      typeof (b as { data?: unknown }).data === "string" &&
      typeof (b as { mimeType?: unknown }).mimeType === "string",
  );
  if (!image) {
    return result;
  }

  if (!image.data.trim()) {
    throw new Error(`read: image payload is empty (${filePath})`);
  }

  const sniffed = await sniffMimeFromBase64(image.data);
  if (!sniffed) {
    return result;
  }

  if (!sniffed.startsWith("image/")) {
    throw new Error(
      `read: file looks like ${sniffed} but was treated as ${image.mimeType} (${filePath})`,
    );
  }

  if (sniffed === image.mimeType) {
    return result;
  }

  const nextContent = content.map((block) => {
    if (block && typeof block === "object" && (block as { type?: unknown }).type === "image") {
      const b = block as ImageContentBlock & { mimeType: string };
      return { ...b, mimeType: sniffed } satisfies ImageContentBlock;
    }
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      const b = block as TextContentBlock & { text: string };
      return {
        ...b,
        text: rewriteReadImageHeader(b.text, sniffed),
      } satisfies TextContentBlock;
    }
    return block;
  });

  return { ...result, content: nextContent };
}

type RequiredParamGroup = {
  keys: readonly string[];
  allowEmpty?: boolean;
  label?: string;
};

export const CLAUDE_PARAM_GROUPS = {
  read: [{ keys: ["path", "file_path"], label: "path (path or file_path)" }],
  write: [{ keys: ["path", "file_path"], label: "path (path or file_path)" }],
  edit: [
    { keys: ["path", "file_path"], label: "path (path or file_path)" },
    {
      keys: ["oldText", "old_string"],
      label: "oldText (oldText or old_string)",
    },
    {
      keys: ["newText", "new_string"],
      allowEmpty: true,
      label: "newText (newText or new_string)",
    },
  ],
} as const;

// Normalize tool parameters from Claude Code conventions to pi-coding-agent conventions.
// Claude Code uses file_path/old_string/new_string while pi-coding-agent uses path/oldText/newText.
// This prevents models trained on Claude Code from getting stuck in tool-call loops.
export function normalizeToolParams(params: unknown): Record<string, unknown> | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const record = params as Record<string, unknown>;
  const normalized = { ...record };
  // file_path → path (read, write, edit)
  if ("file_path" in normalized && !("path" in normalized)) {
    normalized.path = normalized.file_path;
    delete normalized.file_path;
  }
  // old_string → oldText (edit)
  if ("old_string" in normalized && !("oldText" in normalized)) {
    normalized.oldText = normalized.old_string;
    delete normalized.old_string;
  }
  // new_string → newText (edit)
  if ("new_string" in normalized && !("newText" in normalized)) {
    normalized.newText = normalized.new_string;
    delete normalized.new_string;
  }
  return normalized;
}

export function patchToolSchemaForClaudeCompatibility(tool: AnyAgentTool): AnyAgentTool {
  const schema =
    tool.parameters && typeof tool.parameters === "object"
      ? (tool.parameters as Record<string, unknown>)
      : undefined;

  if (!schema || !schema.properties || typeof schema.properties !== "object") {
    return tool;
  }

  const properties = { ...(schema.properties as Record<string, unknown>) };
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
  let changed = false;

  const aliasPairs: Array<{ original: string; alias: string }> = [
    { original: "path", alias: "file_path" },
    { original: "oldText", alias: "old_string" },
    { original: "newText", alias: "new_string" },
  ];

  for (const { original, alias } of aliasPairs) {
    if (!(original in properties)) {
      continue;
    }
    if (!(alias in properties)) {
      properties[alias] = properties[original];
      changed = true;
    }
    const idx = required.indexOf(original);
    if (idx !== -1) {
      required.splice(idx, 1);
      changed = true;
    }
  }

  if (!changed) {
    return tool;
  }

  return {
    ...tool,
    parameters: {
      ...schema,
      properties,
      required,
    },
  };
}

export function assertRequiredParams(
  record: Record<string, unknown> | undefined,
  groups: readonly RequiredParamGroup[],
  toolName: string,
): void {
  if (!record || typeof record !== "object") {
    throw new Error(`Missing parameters for ${toolName}`);
  }

  for (const group of groups) {
    const satisfied = group.keys.some((key) => {
      if (!(key in record)) {
        return false;
      }
      const value = record[key];
      if (typeof value !== "string") {
        return false;
      }
      if (group.allowEmpty) {
        return true;
      }
      return value.trim().length > 0;
    });

    if (!satisfied) {
      const label = group.label ?? group.keys.join(" or ");
      // Show what parameters WERE provided to help debug
      const providedKeys = Object.keys(record).filter(
        (k) => record[k] !== undefined && record[k] !== "",
      );
      const providedInfo =
        providedKeys.length > 0
          ? ` (provided: ${providedKeys.join(", ")})`
          : " (no parameters provided)";
      throw new Error(`Missing required parameter: ${label}${providedInfo}`);
    }
  }
}

// Generic wrapper to normalize parameters for any tool
export function wrapToolParamNormalization(
  tool: AnyAgentTool,
  requiredParamGroups?: readonly RequiredParamGroup[],
): AnyAgentTool {
  const patched = patchToolSchemaForClaudeCompatibility(tool);
  return {
    ...patched,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const normalized = normalizeToolParams(params);
      const record =
        normalized ??
        (params && typeof params === "object" ? (params as Record<string, unknown>) : undefined);
      if (requiredParamGroups?.length) {
        assertRequiredParams(record, requiredParamGroups, tool.name);
      }
      return tool.execute(toolCallId, normalized ?? params, signal, onUpdate);
    },
  };
}

function wrapSandboxPathGuard(tool: AnyAgentTool, root: string): AnyAgentTool {
  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const normalized = normalizeToolParams(args);
      const record =
        normalized ??
        (args && typeof args === "object" ? (args as Record<string, unknown>) : undefined);
      const filePath = record?.path;
      if (typeof filePath === "string" && filePath.trim()) {
        await assertSandboxPath({ filePath, cwd: root, root });
      }
      return tool.execute(toolCallId, normalized ?? args, signal, onUpdate);
    },
  };
}

export function createSandboxedReadTool(root: string) {
  const base = createReadTool(root) as unknown as AnyAgentTool;
  return wrapSandboxPathGuard(createOpenClawReadTool(base, root), root);
}

export function createSandboxedWriteTool(root: string) {
  const base = createWriteTool(root) as unknown as AnyAgentTool;
  return wrapSandboxPathGuard(wrapToolParamNormalization(base, CLAUDE_PARAM_GROUPS.write), root);
}

/**
 * Find a snippet of actual file content around where oldText might be.
 * Returns helpful context when exact match fails.
 */
async function findSimilarTextContext(
  filePath: string,
  oldText: string,
  root: string,
): Promise<string | null> {
  try {
    const absolutePath = pathResolve(root, filePath);
    const content = await readFile(absolutePath, "utf-8");
    const lines = content.split("\n");

    // Normalize both for comparison (strip trailing whitespace, lowercase for searching)
    const normalizedOldText = oldText.trim().toLowerCase();
    const firstLineOfOldText = normalizedOldText.split("\n")[0].trim();

    // If oldText is very short, don't try fuzzy matching
    if (firstLineOfOldText.length < 10) {
      return null;
    }

    // Find lines that contain significant words from oldText
    const significantWords = firstLineOfOldText
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);

    if (significantWords.length === 0) {
      return null;
    }

    // Find best matching line
    let bestLineIndex = -1;
    let bestScore = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      let score = 0;
      for (const word of significantWords) {
        if (lineLower.includes(word)) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestLineIndex = i;
      }
    }

    // If we found a decent match (at least 40% of words), show context
    if (bestScore >= Math.ceil(significantWords.length * 0.4) && bestLineIndex !== -1) {
      const contextStart = Math.max(0, bestLineIndex - 2);
      const contextEnd = Math.min(lines.length, bestLineIndex + 5);
      const contextLines = lines.slice(contextStart, contextEnd);

      // Limit to reasonable length
      const contextText = contextLines.join("\n").slice(0, 500);
      return `\n\nActual file content near potential match (lines ${contextStart + 1}-${contextEnd}):\n\`\`\`\n${contextText}\n\`\`\`\n\nTip: Copy the EXACT text from the file, including all whitespace.`;
    }

    // No good match found - show first few lines of file as reference
    const previewLines = lines.slice(0, 10);
    const preview = previewLines.join("\n").slice(0, 400);
    return `\n\nFile preview (first ${previewLines.length} lines):\n\`\`\`\n${preview}\n\`\`\`\n\nTip: Use 'read' to view the file content first.`;
  } catch {
    return null;
  }
}

/**
 * Detect specific whitespace differences between expected and actual text.
 * Returns a diagnostic message if whitespace issues are found.
 */
function diagnoseWhitespaceDifferences(expected: string, actual: string): string | null {
  const issues: string[] = [];

  // Check line ending differences
  const expectedHasCRLF = expected.includes("\r\n");
  const actualHasCRLF = actual.includes("\r\n");
  if (expectedHasCRLF !== actualHasCRLF) {
    issues.push(
      expectedHasCRLF
        ? "Your oldText uses CRLF (\\r\\n) but file uses LF (\\n)"
        : "File uses CRLF (\\r\\n) but your oldText uses LF (\\n)",
    );
  }

  // Check trailing whitespace on lines
  const expectedLines = expected.split(/\r?\n/);
  const actualLines = actual.split(/\r?\n/);
  const expectedTrailing = expectedLines.some((l) => /\s$/.test(l));
  const actualTrailing = actualLines.some((l) => /\s$/.test(l));
  if (expectedTrailing !== actualTrailing) {
    issues.push(
      expectedTrailing
        ? "Your oldText has trailing whitespace that may not exist in the file"
        : "File has trailing whitespace that your oldText is missing",
    );
  }

  if (issues.length > 0) {
    return "\n\nWhitespace issues detected:\n- " + issues.join("\n- ");
  }
  return null;
}

/**
 * Enhanced edit tool wrapper that provides better error messages when text matching fails.
 */
function wrapEditWithDiagnostics(tool: AnyAgentTool, root: string): AnyAgentTool {
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      try {
        return await tool.execute(toolCallId, params, signal, onUpdate);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Enhance "Could not find the exact text" errors with context
        if (errorMsg.includes("Could not find the exact text")) {
          const record =
            params && typeof params === "object" ? (params as Record<string, unknown>) : undefined;
          const filePath = record?.path ?? record?.file_path;
          const oldText = record?.oldText ?? record?.old_string;

          if (typeof filePath === "string" && typeof oldText === "string") {
            // Read the actual file content to diagnose the mismatch
            try {
              const absolutePath = pathResolve(root, filePath);
              const actualContent = await readFile(absolutePath, "utf-8");

              // Check for whitespace issues
              const wsIssues = diagnoseWhitespaceDifferences(oldText, actualContent);
              if (wsIssues) {
                throw new Error(errorMsg + wsIssues);
              }
            } catch (readErr) {
              // If reading failed for a different reason, continue with fuzzy matching
              if (readErr instanceof Error && readErr.message.includes("Whitespace issues")) {
                throw readErr;
              }
            }

            const context = await findSimilarTextContext(filePath, oldText, root);
            if (context) {
              throw new Error(errorMsg + context);
            }
          }
        }

        throw error;
      }
    },
  };
}

export function createSandboxedEditTool(root: string) {
  const base = createEditTool(root) as unknown as AnyAgentTool;
  const normalized = wrapToolParamNormalization(base, CLAUDE_PARAM_GROUPS.edit);
  const withDiagnostics = wrapEditWithDiagnostics(normalized, root);
  return wrapSandboxPathGuard(withDiagnostics, root);
}

export function createOpenClawReadTool(base: AnyAgentTool, root?: string): AnyAgentTool {
  const patched = patchToolSchemaForClaudeCompatibility(base);
  return {
    ...patched,
    execute: async (toolCallId, params, signal) => {
      const normalized = normalizeToolParams(params);
      const record =
        normalized ??
        (params && typeof params === "object" ? (params as Record<string, unknown>) : undefined);
      assertRequiredParams(record, CLAUDE_PARAM_GROUPS.read, base.name);

      // Pre-check: detect if path is a directory before passing to upstream tool
      // This prevents the cryptic EISDIR error from the upstream library
      const rawPath = record?.path;
      // Resolve path relative to root if provided (fixes EISDIR/ENOENT when path is relative)
      const filePath =
        typeof rawPath === "string" && rawPath.trim() && root
          ? pathResolve(root, rawPath)
          : rawPath;
      if (typeof filePath === "string" && filePath.trim()) {
        try {
          const stats = await stat(filePath);
          if (stats.isDirectory()) {
            throw new Error(
              `Cannot read '${rawPath}': path is a directory. Use 'ls' or 'find' to list directory contents, or specify a file path.`,
            );
          }
        } catch (err) {
          // If stat fails with ENOENT, let the upstream tool handle it (it has better error messages)
          // Only re-throw our directory error
          if (err instanceof Error && err.message.includes("is a directory")) {
            throw err;
          }
          // For other errors (ENOENT, EACCES, etc.), fall through to upstream
        }
      }

      try {
        const result = await base.execute(toolCallId, normalized ?? params, signal);
        const resolvedPath = typeof record?.path === "string" ? String(record.path) : "<unknown>";
        const normalizedResult = await normalizeReadImageResult(result, resolvedPath);
        return sanitizeToolResultImages(normalizedResult, `read:${resolvedPath}`);
      } catch (err) {
        // Convert raw EISDIR errors to user-friendly message
        // This catches edge cases where the pre-check stat() fails but base.execute() hits EISDIR
        // (e.g., race conditions, path normalization differences, permission issues during stat)
        if (err instanceof Error && err.message.includes("EISDIR")) {
          throw new Error(
            `Cannot read '${rawPath}': path is a directory. Use 'ls' or 'find' to list directory contents, or specify a file path.`,
          );
        }
        throw err;
      }
    },
  };
}
