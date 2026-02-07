import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parsePatch,
  parseApplyPatchFormat,
  analyzePatchSemantics,
  detectConflicts,
  detectPatchOverlap,
  findFuzzyMatch,
  applyPatchAdvanced,
  composePatches,
  generateDiff,
  patchToUnifiedDiff,
  type PatchHunk,
} from "./patch-parser-advanced.js";

describe("Advanced Patch Parser", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `patch-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("parsePatch", () => {
    it("should parse unified diff format", () => {
      const patch = `--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;
 const z = 3;
`;

      const result = parsePatch(patch);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].oldPath).toBe("src/file.ts");
      expect(result.files[0].newPath).toBe("src/file.ts");
      expect(result.files[0].hunks).toHaveLength(1);
      expect(result.files[0].hunks[0].additions).toContain("const y = 2;");
    });

    it("should detect new files", () => {
      const patch = `--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,2 @@
+export const newThing = 42;
+export default newThing;
`;

      const result = parsePatch(patch);

      expect(result.files[0].isNew).toBe(true);
      expect(result.files[0].newPath).toBe("src/new-file.ts");
    });

    it("should detect deleted files", () => {
      const patch = `--- a/src/old-file.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const oldThing = 42;
-export default oldThing;
`;

      const result = parsePatch(patch);

      expect(result.files[0].isDeleted).toBe(true);
      expect(result.files[0].oldPath).toBe("src/old-file.ts");
    });

    it("should parse multiple hunks", () => {
      const patch = `--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;
@@ -10,3 +11,4 @@
 const x = 10;
+const y = 11;
 const z = 12;
`;

      const result = parsePatch(patch);

      expect(result.files[0].hunks).toHaveLength(2);
      expect(result.files[0].hunks[0].oldStart).toBe(1);
      expect(result.files[0].hunks[1].oldStart).toBe(10);
    });
  });

  describe("parseApplyPatchFormat", () => {
    it("should parse apply_patch format", () => {
      const content = `*** Begin Patch
*** src/file.ts
-old line
+new line
*** End Patch`;

      const result = parseApplyPatchFormat(content);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].oldPath).toBe("src/file.ts");
      expect(result.files[0].hunks[0].removals).toContain("old line");
      expect(result.files[0].hunks[0].additions).toContain("new line");
    });

    it("should handle Add File directive", () => {
      const content = `*** Begin Patch
*** Add File: src/new.ts
+export const x = 1;
+export const y = 2;
*** End Patch`;

      const result = parseApplyPatchFormat(content);

      expect(result.files[0].isNew).toBe(true);
      expect(result.files[0].newPath).toBe("src/new.ts");
    });

    it("should handle Delete File directive", () => {
      const content = `*** Begin Patch
*** Delete File: src/old.ts
*** End Patch`;

      const result = parseApplyPatchFormat(content);

      expect(result.files[0].isDeleted).toBe(true);
      expect(result.files[0].oldPath).toBe("src/old.ts");
    });
  });

  describe("analyzePatchSemantics", () => {
    it("should detect test-only changes", () => {
      const patch = parsePatch(`--- a/src/utils.test.ts
+++ b/src/utils.test.ts
@@ -1,3 +1,4 @@
 describe("test", () => {
+  it("new test", () => {});
 });
`);

      const analysis = analyzePatchSemantics(patch);

      expect(analysis.type).toBe("test");
    });

    it("should calculate complexity based on changes", () => {
      // Small change
      const smallPatch = parsePatch(`--- a/src/file.ts
+++ b/src/file.ts
@@ -1,1 +1,2 @@
 const x = 1;
+const y = 2;
`);

      // Large change (simulate with multiple hunks)
      const largePatch = parsePatch(`--- a/src/file.ts
+++ b/src/file.ts
@@ -1,50 +1,100 @@
${Array(50).fill("-old line\n+new line 1\n+new line 2").join("\n")}
`);

      expect(analyzePatchSemantics(smallPatch).complexity).toBe("low");
      expect(analyzePatchSemantics(largePatch).complexity).toBe("high");
    });

    it("should detect feature additions", () => {
      const patch = parsePatch(`--- /dev/null
+++ b/src/new-feature.ts
@@ -0,0 +1,5 @@
+export function newFeature() {
+  return 42;
+}
`);

      const analysis = analyzePatchSemantics(patch);

      expect(analysis.type).toBe("feature");
    });
  });

  describe("detectConflicts", () => {
    it("should detect missing files", async () => {
      const patch = parsePatch(`--- a/nonexistent.ts
+++ b/nonexistent.ts
@@ -1,1 +1,2 @@
 const x = 1;
+const y = 2;
`);

      const conflicts = await detectConflicts(patch, testDir);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe("missing_file");
    });

    it("should detect context mismatch", async () => {
      await fs.writeFile(path.join(testDir, "file.ts"), "const different = 'content';\n");

      const patch = parsePatch(`--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,2 @@
 const x = 1;
+const y = 2;
`);

      const conflicts = await detectConflicts(patch, testDir);

      expect(conflicts.some((c) => c.type === "context_mismatch")).toBe(true);
    });

    it("should detect already applied patches", async () => {
      await fs.writeFile(path.join(testDir, "file.ts"), "const x = 1;\nconst y = 2;\n");

      const patch = parsePatch(`--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,2 @@
 const x = 1;
+const y = 2;
`);

      const conflicts = await detectConflicts(patch, testDir);

      expect(conflicts.some((c) => c.type === "already_applied")).toBe(true);
    });
  });

  describe("detectPatchOverlap", () => {
    it("should detect overlapping hunks", () => {
      const patch1 = parsePatch(`--- a/file.ts
+++ b/file.ts
@@ -5,5 +5,6 @@
 line 5
+new line
 line 6
`);

      const patch2 = parsePatch(`--- a/file.ts
+++ b/file.ts
@@ -6,5 +6,6 @@
 line 6
+another line
 line 7
`);

      const overlaps = detectPatchOverlap(patch1, patch2);

      expect(overlaps.length).toBeGreaterThan(0);
      expect(overlaps[0].type).toBe("overlap");
    });

    it("should not flag non-overlapping patches", () => {
      const patch1 = parsePatch(`--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,3 @@
 line 1
+new line
 line 2
`);

      const patch2 = parsePatch(`--- a/file.ts
+++ b/file.ts
@@ -100,2 +100,3 @@
 line 100
+another line
 line 101
`);

      const overlaps = detectPatchOverlap(patch1, patch2);

      expect(overlaps).toHaveLength(0);
    });
  });

  describe("findFuzzyMatch", () => {
    it("should find exact match at expected position", () => {
      const hunk: PatchHunk = {
        oldStart: 3,
        oldLines: 2,
        newStart: 3,
        newLines: 3,
        context: ["line 3"],
        removals: ["line 3"],
        additions: ["new line 3", "extra line"],
        rawLines: ["@@ -3,2 +3,3 @@", " line 3", "-line 3", "+new line 3", "+extra line"],
      };

      const fileLines = ["line 1", "line 2", "line 3", "line 4"];

      const result = findFuzzyMatch(hunk, fileLines);

      expect(result).not.toBeNull();
      expect(result?.offset).toBe(0);
      expect(result?.similarity).toBe(1);
    });

    it("should find match with offset", () => {
      const hunk: PatchHunk = {
        oldStart: 3,
        oldLines: 1,
        newStart: 3,
        newLines: 2,
        context: [],
        removals: ["target line"],
        additions: ["new line 1", "new line 2"],
        rawLines: ["@@ -3,1 +3,2 @@", "-target line", "+new line 1", "+new line 2"],
      };

      // Target line is actually at position 5, not 3
      const fileLines = ["line 1", "line 2", "other", "other", "target line", "line 6"];

      const result = findFuzzyMatch(hunk, fileLines, { maxOffset: 10 });

      expect(result).not.toBeNull();
      expect(result?.offset).toBe(2); // 3+2 = 5 (0-indexed: 4)
    });

    it("should return null for no match", () => {
      const hunk: PatchHunk = {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        context: [],
        removals: ["unique content that doesn't exist"],
        additions: ["replacement"],
        rawLines: ["@@ -1,1 +1,1 @@", "-unique content that doesn't exist", "+replacement"],
      };

      const fileLines = ["completely", "different", "content"];

      const result = findFuzzyMatch(hunk, fileLines, { minSimilarity: 0.9 });

      expect(result).toBeNull();
    });
  });

  describe("applyPatchAdvanced", () => {
    it("should apply simple patch", async () => {
      await fs.writeFile(path.join(testDir, "file.ts"), "const x = 1;\nconst z = 3;\n");

      const patch = parsePatch(`--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
 const z = 3;
`);

      const result = await applyPatchAdvanced(patch, testDir);

      expect(result.success).toBe(true);
      expect(result.applied).toContain("file.ts");

      const content = await fs.readFile(path.join(testDir, "file.ts"), "utf-8");
      expect(content).toContain("const y = 2;");
    });

    it("should create new files", async () => {
      const patch = parsePatch(`--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export default x;
`);

      const result = await applyPatchAdvanced(patch, testDir);

      expect(result.success).toBe(true);
      expect(result.applied).toContain("new-file.ts");

      const content = await fs.readFile(path.join(testDir, "new-file.ts"), "utf-8");
      expect(content).toContain("export const x = 1;");
    });

    it("should delete files", async () => {
      await fs.writeFile(path.join(testDir, "to-delete.ts"), "old content");

      const patch = parsePatch(`--- a/to-delete.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-old content
`);

      const result = await applyPatchAdvanced(patch, testDir);

      expect(result.success).toBe(true);
      await expect(fs.access(path.join(testDir, "to-delete.ts"))).rejects.toThrow();
    });

    it("should use fuzzy matching when enabled", async () => {
      // File with extra lines inserted
      await fs.writeFile(
        path.join(testDir, "file.ts"),
        "header\nextra\nextra2\nconst x = 1;\nconst z = 3;\n",
      );

      // Patch expects content at line 1
      const patch = parsePatch(`--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
 const z = 3;
`);

      const result = await applyPatchAdvanced(patch, testDir, { fuzzyMatch: true });

      expect(result.success).toBe(true);
      expect(result.fuzzyMatches.length).toBeGreaterThan(0);

      const content = await fs.readFile(path.join(testDir, "file.ts"), "utf-8");
      expect(content).toContain("const y = 2;");
    });

    it("should support dry run mode", async () => {
      await fs.writeFile(path.join(testDir, "file.ts"), "const x = 1;\n");

      const patch = parsePatch(`--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,2 @@
 const x = 1;
+const y = 2;
`);

      const result = await applyPatchAdvanced(patch, testDir, { dryRun: true });

      expect(result.success).toBe(true);

      // File should be unchanged
      const content = await fs.readFile(path.join(testDir, "file.ts"), "utf-8");
      expect(content).not.toContain("const y = 2;");
    });
  });

  describe("composePatches", () => {
    it("should compose non-overlapping patches", () => {
      const patch1 = parsePatch(`--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,2 @@
 line 1
+new line
`);

      const patch2 = parsePatch(`--- a/file2.ts
+++ b/file2.ts
@@ -1,1 +1,2 @@
 line 1
+new line
`);

      const composed = composePatches([patch1, patch2]);

      expect(composed.composable).toBe(true);
      expect(composed.conflicts).toHaveLength(0);
      expect(composed.patches).toHaveLength(2);
    });

    it("should detect conflicts in composed patches", () => {
      const patch1 = parsePatch(`--- a/file.ts
+++ b/file.ts
@@ -5,3 +5,4 @@
 line 5
+new line 1
 line 6
`);

      const patch2 = parsePatch(`--- a/file.ts
+++ b/file.ts
@@ -5,3 +5,4 @@
 line 5
+new line 2
 line 6
`);

      const composed = composePatches([patch1, patch2]);

      expect(composed.composable).toBe(false);
      expect(composed.conflicts.length).toBeGreaterThan(0);
    });
  });

  describe("generateDiff", () => {
    it("should generate unified diff", () => {
      const oldContent = "line 1\nline 2\n";
      const newContent = "line 1\nnew line\nline 2\n";

      const diff = generateDiff(oldContent, newContent, "test.ts");

      expect(diff).toContain("--- a/test.ts");
      expect(diff).toContain("+++ b/test.ts");
      expect(diff).toContain("-line 1");
      expect(diff).toContain("+new line");
    });
  });

  describe("patchToUnifiedDiff", () => {
    it("should convert parsed patch back to diff format", () => {
      const original = `--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
 const z = 3;`;

      const parsed = parsePatch(original);
      const converted = patchToUnifiedDiff(parsed);

      expect(converted).toContain("--- a/file.ts");
      expect(converted).toContain("+++ b/file.ts");
      expect(converted).toContain("@@ -1,2 +1,3 @@");
    });
  });
});
