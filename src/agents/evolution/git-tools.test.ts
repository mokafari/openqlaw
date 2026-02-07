/**
 * Tests for Git Blame Integration Tool
 */

import { execSync } from "node:child_process";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GitTools, createGitTools, type BlameEntry, type CommitInfo } from "./git-tools.js";

// Mock execSync for unit tests
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

describe("GitTools", () => {
  let gitTools: GitTools;

  beforeEach(() => {
    gitTools = new GitTools("/fake/repo");
    vi.clearAllMocks();
  });

  describe("blame parsing", () => {
    it("parses porcelain blame output correctly", async () => {
      const mockBlameOutput = `a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0 1 1 1
author John Doe
author-mail <john@example.com>
author-time 1704067200
author-tz +0000
committer John Doe
committer-mail <john@example.com>
committer-time 1704067200
committer-tz +0000
summary Initial commit
filename src/test.ts
\tconst x = 1;`;

      vi.mocked(execSync).mockReturnValue(mockBlameOutput);

      const entries = await gitTools.blame("src/test.ts");

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        commit: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0",
        author: "John Doe",
        authorEmail: "john@example.com",
        content: "const x = 1;",
        lineNumber: 1,
      });
    });

    it("handles empty blame output", async () => {
      vi.mocked(execSync).mockReturnValue("");
      const entries = await gitTools.blame("empty.ts");
      expect(entries).toHaveLength(0);
    });
  });

  describe("getCommit", () => {
    it("parses commit info correctly", async () => {
      const mockOutput = `abc1234567890def1234567890abc1234567890de
abc1234
John Doe
john@example.com
2024-01-01T12:00:00+00:00
Fix bug in parser

 src/parser.ts | 10 +++++-----
 1 file changed, 5 insertions(+), 5 deletions(-)`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const commit = await gitTools.getCommit("abc1234");

      expect(commit.hash).toBe("abc1234567890def1234567890abc1234567890de");
      expect(commit.shortHash).toBe("abc1234");
      expect(commit.author).toBe("John Doe");
      expect(commit.authorEmail).toBe("john@example.com");
      expect(commit.message).toBe("Fix bug in parser");
    });
  });

  describe("getRecentCommits", () => {
    it("parses multiple commits", async () => {
      const mockOutput = `abc123|abc|John|john@example.com|2024-01-01T12:00:00+00:00|First commit
def456|def|Jane|jane@example.com|2024-01-02T12:00:00+00:00|Second commit`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const commits = await gitTools.getRecentCommits(undefined, 10);

      expect(commits).toHaveLength(2);
      expect(commits[0].message).toBe("First commit");
      expect(commits[1].message).toBe("Second commit");
    });
  });

  describe("getChangeAttribution", () => {
    it("aggregates author statistics", async () => {
      const mockBlameOutput = `a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0 1 1 1
author John Doe
author-mail <john@example.com>
author-time 1704067200
summary Commit 1
filename test.ts
\tline 1
b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d1 2 2 1
author Jane Smith
author-mail <jane@example.com>
author-time 1704153600
summary Commit 2
filename test.ts
\tline 2
c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d2a2 3 3 1
author John Doe
author-mail <john@example.com>
author-time 1704240000
summary Commit 3
filename test.ts
\tline 3`;

      const mockLogOutput = `abc|abc|John|john@example.com|2024-01-03T12:00:00+00:00|Latest`;

      vi.mocked(execSync)
        .mockReturnValueOnce(mockBlameOutput) // For blame
        .mockReturnValueOnce(mockLogOutput); // For getRecentCommits

      const attribution = await gitTools.getChangeAttribution("test.ts");

      expect(attribution.totalLines).toBe(3);
      expect(attribution.authors).toHaveLength(2);
      expect(attribution.authors[0].author).toBe("John Doe");
      expect(attribution.authors[0].lines).toBe(2);
      expect(attribution.authors[0].percentage).toBeCloseTo(66.67, 1);
    });
  });

  describe("utility methods", () => {
    it("getCurrentBranch returns branch name", async () => {
      vi.mocked(execSync).mockReturnValue("main\n");
      const branch = await gitTools.getCurrentBranch();
      expect(branch).toBe("main");
    });

    it("isClean returns true for clean repo", async () => {
      vi.mocked(execSync).mockReturnValue("");
      const clean = await gitTools.isClean();
      expect(clean).toBe(true);
    });

    it("isClean returns false for dirty repo", async () => {
      vi.mocked(execSync).mockReturnValue(" M src/file.ts\n");
      const clean = await gitTools.isClean();
      expect(clean).toBe(false);
    });
  });
});

describe("createGitTools", () => {
  it("creates GitTools with default cwd", () => {
    const tools = createGitTools();
    expect(tools).toBeInstanceOf(GitTools);
  });

  it("creates GitTools with custom path", () => {
    const tools = createGitTools("/custom/path");
    expect(tools).toBeInstanceOf(GitTools);
  });
});
