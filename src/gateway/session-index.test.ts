import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendSessionIndexEntry,
  buildIndexEntryFromTranscriptLine,
  indexPathForTranscript,
  readSessionIndex,
  rebuildSessionIndex,
  updateSessionIndexFromTail,
  type SessionIndexEntry,
} from "./session-index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-idx-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("indexPathForTranscript", () => {
  it("appends .idx to transcript path", () => {
    expect(indexPathForTranscript("/a/b/session.jsonl")).toBe("/a/b/session.jsonl.idx");
  });
});

describe("buildIndexEntryFromTranscriptLine", () => {
  it("parses a valid transcript line", () => {
    const line = JSON.stringify({
      type: "message",
      id: "abc",
      timestamp: "2025-01-01T00:00:00.000Z",
      message: { role: "user", content: "hello" },
    });
    const entry = buildIndexEntryFromTranscriptLine(line, 100, 5);
    expect(entry).not.toBeNull();
    expect(entry!.n).toBe(5);
    expect(entry!.off).toBe(100);
    expect(entry!.role).toBe("user");
    expect(entry!.len).toBe(Buffer.byteLength(line + "\n", "utf-8"));
  });

  it("returns null for invalid JSON", () => {
    expect(buildIndexEntryFromTranscriptLine("not json{", 0, 1)).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(buildIndexEntryFromTranscriptLine('"just a string"', 0, 1)).toBeNull();
  });

  it("handles missing role gracefully", () => {
    const line = JSON.stringify({ type: "session", version: 1 });
    const entry = buildIndexEntryFromTranscriptLine(line, 0, 1);
    expect(entry).not.toBeNull();
    expect(entry!.role).toBe("unknown");
  });
});

describe("readSessionIndex", () => {
  it("returns empty array for missing file", () => {
    expect(readSessionIndex(path.join(tmpDir, "missing.idx"))).toEqual([]);
  });

  it("returns empty array for empty file", () => {
    const idxPath = path.join(tmpDir, "empty.idx");
    fs.writeFileSync(idxPath, "", "utf-8");
    expect(readSessionIndex(idxPath)).toEqual([]);
  });

  it("skips corrupt lines", () => {
    const idxPath = path.join(tmpDir, "corrupt.idx");
    const valid: SessionIndexEntry = { n: 1, off: 0, len: 50, role: "user", ts: 1000 };
    fs.writeFileSync(idxPath, `${JSON.stringify(valid)}\nnot json\n`, "utf-8");
    const entries = readSessionIndex(idxPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].n).toBe(1);
  });

  it("reads valid entries", () => {
    const idxPath = path.join(tmpDir, "valid.idx");
    const e1: SessionIndexEntry = { n: 1, off: 0, len: 50, role: "user", ts: 1000 };
    const e2: SessionIndexEntry = { n: 2, off: 50, len: 60, role: "assistant", ts: 2000 };
    fs.writeFileSync(idxPath, `${JSON.stringify(e1)}\n${JSON.stringify(e2)}\n`, "utf-8");
    const entries = readSessionIndex(idxPath);
    expect(entries).toHaveLength(2);
    expect(entries[0].role).toBe("user");
    expect(entries[1].role).toBe("assistant");
  });
});

describe("appendSessionIndexEntry", () => {
  it("creates file and appends entry", () => {
    const idxPath = path.join(tmpDir, "sub", "append.idx");
    const entry: SessionIndexEntry = { n: 1, off: 0, len: 50, role: "user", ts: 1000 };
    appendSessionIndexEntry(idxPath, entry);
    expect(fs.existsSync(idxPath)).toBe(true);
    const entries = readSessionIndex(idxPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].n).toBe(1);
  });

  it("appends multiple entries", () => {
    const idxPath = path.join(tmpDir, "multi.idx");
    appendSessionIndexEntry(idxPath, { n: 1, off: 0, len: 50, role: "user", ts: 1000 });
    appendSessionIndexEntry(idxPath, { n: 2, off: 50, len: 60, role: "assistant", ts: 2000 });
    const entries = readSessionIndex(idxPath);
    expect(entries).toHaveLength(2);
  });
});

describe("rebuildSessionIndex", () => {
  it("builds index matching manual line count", () => {
    const transcriptPath = path.join(tmpDir, "session.jsonl");
    const header = JSON.stringify({ type: "session", version: 1, id: "test" });
    const msg1 = JSON.stringify({
      type: "message",
      id: "1",
      timestamp: "2025-01-01T00:00:00Z",
      message: { role: "user", content: "hello" },
    });
    const msg2 = JSON.stringify({
      type: "message",
      id: "2",
      timestamp: "2025-01-01T00:01:00Z",
      message: { role: "assistant", content: "hi" },
    });
    fs.writeFileSync(transcriptPath, `${header}\n${msg1}\n${msg2}\n`, "utf-8");

    rebuildSessionIndex(transcriptPath);

    const idxPath = indexPathForTranscript(transcriptPath);
    expect(fs.existsSync(idxPath)).toBe(true);
    const entries = readSessionIndex(idxPath);
    expect(entries).toHaveLength(2);
    expect(entries[0].role).toBe("user");
    expect(entries[0].n).toBe(1);
    expect(entries[1].role).toBe("assistant");
    expect(entries[1].n).toBe(2);
  });

  it("handles missing file gracefully", () => {
    rebuildSessionIndex(path.join(tmpDir, "nonexistent.jsonl"));
    // Should not throw
  });
});

describe("updateSessionIndexFromTail", () => {
  it("builds index entry for last appended message", () => {
    const transcriptPath = path.join(tmpDir, "tail.jsonl");
    const header = JSON.stringify({ type: "session", version: 1, id: "test" });
    const msg = JSON.stringify({
      type: "message",
      id: "1",
      message: { role: "user", content: "hello" },
    });
    fs.writeFileSync(transcriptPath, `${header}\n${msg}\n`, "utf-8");

    updateSessionIndexFromTail(transcriptPath);

    const idxPath = indexPathForTranscript(transcriptPath);
    const entries = readSessionIndex(idxPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].role).toBe("user");
  });
});
