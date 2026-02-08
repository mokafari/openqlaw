import fs from "node:fs";
import path from "node:path";

export type SessionIndexEntry = {
  /** 1-indexed message number */
  n: number;
  /** byte offset in .jsonl */
  off: number;
  /** byte length of line (including \n) */
  len: number;
  /** user | assistant | system | tool */
  role: string;
  /** unix ms */
  ts: number;
};

export function indexPathForTranscript(transcriptPath: string): string {
  return `${transcriptPath}.idx`;
}

export function appendSessionIndexEntry(idxPath: string, entry: SessionIndexEntry): void {
  const dir = path.dirname(idxPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(idxPath, `${JSON.stringify(entry)}\n`, "utf-8");
}

export function readSessionIndex(idxPath: string): SessionIndexEntry[] {
  try {
    if (!fs.existsSync(idxPath)) {
      return [];
    }
    const raw = fs.readFileSync(idxPath, "utf-8");
    const lines = raw.split(/\r?\n/);
    const entries: SessionIndexEntry[] = [];
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as SessionIndexEntry;
        if (typeof parsed.n === "number" && typeof parsed.off === "number") {
          entries.push(parsed);
        }
      } catch {
        // skip corrupt lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export function buildIndexEntryFromTranscriptLine(
  jsonLine: string,
  byteOffset: number,
  msgNum: number,
): SessionIndexEntry | null {
  try {
    const parsed = JSON.parse(jsonLine);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const message = parsed.message as { role?: unknown; timestamp?: unknown } | undefined;
    const role = typeof message?.role === "string" ? message.role : "unknown";
    const lineTs = parsed.timestamp
      ? new Date(parsed.timestamp as string).getTime()
      : typeof message?.timestamp === "number"
        ? message.timestamp
        : Date.now();
    const lineBytes = Buffer.byteLength(jsonLine + "\n", "utf-8");
    return {
      n: msgNum,
      off: byteOffset,
      len: lineBytes,
      role,
      ts: lineTs,
    };
  } catch {
    return null;
  }
}

export function rebuildSessionIndex(transcriptPath: string): void {
  if (!fs.existsSync(transcriptPath)) {
    return;
  }
  const idxPath = indexPathForTranscript(transcriptPath);
  const tmpPath = `${idxPath}.tmp`;
  const raw = fs.readFileSync(transcriptPath, "utf-8");
  const lines = raw.split(/\r?\n/);
  let byteOffset = 0;
  let msgNum = 0;
  const entries: string[] = [];
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line + "\n", "utf-8");
    if (line.trim()) {
      try {
        const parsed = JSON.parse(line);
        // Only index message entries (skip session headers, etc.)
        if (parsed?.type === "message" || parsed?.message) {
          msgNum += 1;
          const entry = buildIndexEntryFromTranscriptLine(line, byteOffset, msgNum);
          if (entry) {
            entries.push(JSON.stringify(entry));
          }
        }
      } catch {
        // skip unparseable lines
      }
    }
    byteOffset += lineBytes;
  }
  const dir = path.dirname(tmpPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(tmpPath, entries.length > 0 ? `${entries.join("\n")}\n` : "", "utf-8");
  fs.renameSync(tmpPath, idxPath);
}

/**
 * Best-effort index update after a transcript append.
 * Reads the last line of the transcript and appends a new index entry.
 */
export function updateSessionIndexFromTail(sessionFile: string): void {
  try {
    const idxPath = indexPathForTranscript(sessionFile);
    const existing = readSessionIndex(idxPath);
    const lastN = existing.length > 0 ? existing[existing.length - 1].n : 0;

    const stat = fs.statSync(sessionFile);
    const fileSize = stat.size;
    if (fileSize === 0) {
      return;
    }

    // Read last chunk to find the last line
    const readBytes = Math.min(fileSize, 16384);
    const fd = fs.openSync(sessionFile, "r");
    try {
      const buf = Buffer.alloc(readBytes);
      fs.readSync(fd, buf, 0, readBytes, fileSize - readBytes);
      const chunk = buf.toString("utf-8");
      const lines = chunk.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length === 0) {
        return;
      }
      const lastLine = lines[lines.length - 1];
      const lineBytes = Buffer.byteLength(lastLine + "\n", "utf-8");
      const offset = fileSize - lineBytes;
      const entry = buildIndexEntryFromTranscriptLine(lastLine, offset, lastN + 1);
      if (entry) {
        appendSessionIndexEntry(idxPath, entry);
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // best-effort — never block message flow
  }
}

/**
 * Extract the role from a transcript entry (used when we already have the parsed object).
 */
export function extractRoleFromEntry(entry: unknown): string {
  if (!entry || typeof entry !== "object") {
    return "unknown";
  }
  const message = (entry as { message?: { role?: unknown } }).message;
  if (message && typeof message.role === "string") {
    return message.role;
  }
  return "unknown";
}
