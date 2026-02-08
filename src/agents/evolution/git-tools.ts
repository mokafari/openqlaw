/**
 * Git Blame Integration Tool
 *
 * Parse git blame output, track line changes, link commits to patches,
 * and build change attribution reports.
 */

import { execFileSync, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * Blame entry for a single line.
 */
export type BlameEntry = {
  commit: string;
  author: string;
  authorEmail: string;
  authorTime: Date;
  summary: string;
  lineNumber: number;
  content: string;
  filename: string;
};

/**
 * Commit summary with file changes.
 */
export type CommitInfo = {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: Date;
  message: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: string[];
};

/**
 * Change attribution for a file or range.
 */
export type ChangeAttribution = {
  file: string;
  totalLines: number;
  authors: Array<{
    author: string;
    email: string;
    lines: number;
    percentage: number;
    lastCommit: Date;
  }>;
  recentChanges: Array<{
    commit: string;
    author: string;
    date: Date;
    summary: string;
    linesChanged: number;
  }>;
};

/**
 * Patch-to-commit linkage.
 */
export type PatchCommitLink = {
  patchId: string;
  commits: string[];
  files: string[];
  timestamp: Date;
};

/**
 * Git tools for evolution system.
 */
export class GitTools {
  private readonly repoPath: string;
  private readonly timeout: number;

  constructor(repoPath: string, timeout = 30000) {
    this.repoPath = repoPath;
    this.timeout = timeout;
  }

  /**
   * Run a git command and return output.
   * Uses execFileSync to avoid shell interpretation of special characters.
   */
  private runGit(args: string[]): string {
    const cmdStr = `git ${args.join(" ")}`;
    try {
      return execFileSync("git", args, {
        cwd: this.repoPath,
        encoding: "utf-8",
        timeout: this.timeout,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch (err) {
      const error = err as { stderr?: string; message?: string; code?: string; killed?: boolean };
      const reason = error.killed
        ? `Timed out after ${this.timeout}ms`
        : error.stderr?.trim() || error.message || "Unknown error";
      throw new Error(
        `Git command failed:\n` +
          `  Command: ${cmdStr}\n` +
          `  CWD: ${this.repoPath}\n` +
          `  Error: ${reason}`,
      );
    }
  }

  /**
   * Parse git blame output for a file.
   */
  async blame(
    filePath: string,
    options?: { startLine?: number; endLine?: number },
  ): Promise<BlameEntry[]> {
    const relativePath = filePath.startsWith("/") ? relative(this.repoPath, filePath) : filePath;

    let args = ["blame", "--porcelain"];
    if (options?.startLine && options?.endLine) {
      args.push(`-L${options.startLine},${options.endLine}`);
    }
    args.push("--", relativePath);

    const output = this.runGit(args);
    return this.parseBlameOutput(output, relativePath);
  }

  /**
   * Parse porcelain blame output into structured entries.
   */
  private parseBlameOutput(output: string, filename: string): BlameEntry[] {
    const entries: BlameEntry[] = [];
    const lines = output.split("\n");

    let currentEntry: Partial<BlameEntry> = {};
    let lineNumber = 0;

    for (const line of lines) {
      // Commit line: starts with 40-char hash
      const commitMatch = line.match(/^([a-f0-9]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/);
      if (commitMatch) {
        currentEntry = {
          commit: commitMatch[1],
          filename,
        };
        lineNumber = parseInt(commitMatch[3], 10);
        continue;
      }

      // Author line
      if (line.startsWith("author ")) {
        currentEntry.author = line.slice(7);
        continue;
      }

      // Author email
      if (line.startsWith("author-mail ")) {
        currentEntry.authorEmail = line.slice(12).replace(/[<>]/g, "");
        continue;
      }

      // Author time (unix timestamp)
      if (line.startsWith("author-time ")) {
        currentEntry.authorTime = new Date(parseInt(line.slice(12), 10) * 1000);
        continue;
      }

      // Summary (commit message first line)
      if (line.startsWith("summary ")) {
        currentEntry.summary = line.slice(8);
        continue;
      }

      // Content line (starts with tab)
      if (line.startsWith("\t")) {
        currentEntry.content = line.slice(1);
        currentEntry.lineNumber = lineNumber;
        entries.push(currentEntry as BlameEntry);
        currentEntry = {};
      }
    }

    return entries;
  }

  /**
   * Get commit information.
   */
  async getCommit(commitHash: string): Promise<CommitInfo> {
    const format = "%H%n%h%n%an%n%ae%n%aI%n%s";
    const output = this.runGit(["show", "--format=" + format, "--stat", commitHash]);
    const lines = output.split("\n");

    const files: string[] = [];
    let insertions = 0;
    let deletions = 0;
    let filesChanged = 0;

    // Parse stat lines
    for (const line of lines.slice(6)) {
      const fileMatch = line.match(/^\s+(.+?)\s+\|\s+(\d+)/);
      if (fileMatch) {
        files.push(fileMatch[1].trim());
      }
      const summaryMatch = line.match(
        /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?)?(?:,\s+(\d+)\s+deletions?)?/,
      );
      if (summaryMatch) {
        filesChanged = parseInt(summaryMatch[1], 10);
        insertions = parseInt(summaryMatch[2] ?? "0", 10);
        deletions = parseInt(summaryMatch[3] ?? "0", 10);
      }
    }

    return {
      hash: lines[0],
      shortHash: lines[1],
      author: lines[2],
      authorEmail: lines[3],
      date: new Date(lines[4]),
      message: lines[5],
      filesChanged,
      insertions,
      deletions,
      files,
    };
  }

  /**
   * Get recent commits for a file or directory.
   */
  async getRecentCommits(path?: string, limit = 10): Promise<CommitInfo[]> {
    const format = "%H|%h|%an|%ae|%aI|%s";
    const args = ["log", `--format=${format}`, `-${limit}`];
    if (path) {
      args.push("--", path);
    }

    const output = this.runGit(args);
    const commits: CommitInfo[] = [];

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const [hash, shortHash, author, authorEmail, dateStr, message] = line.split("|");
      commits.push({
        hash,
        shortHash,
        author,
        authorEmail,
        date: new Date(dateStr),
        message,
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        files: [],
      });
    }

    return commits;
  }

  /**
   * Build change attribution report for a file.
   */
  async getChangeAttribution(filePath: string): Promise<ChangeAttribution> {
    const blameEntries = await this.blame(filePath);
    const authorStats = new Map<string, { email: string; lines: number; lastCommit: Date }>();

    for (const entry of blameEntries) {
      const existing = authorStats.get(entry.author) ?? {
        email: entry.authorEmail,
        lines: 0,
        lastCommit: new Date(0),
      };
      existing.lines++;
      if (entry.authorTime > existing.lastCommit) {
        existing.lastCommit = entry.authorTime;
      }
      authorStats.set(entry.author, existing);
    }

    const totalLines = blameEntries.length;
    const authors = Array.from(authorStats.entries())
      .map(([author, stats]) => ({
        author,
        email: stats.email,
        lines: stats.lines,
        percentage: (stats.lines / totalLines) * 100,
        lastCommit: stats.lastCommit,
      }))
      .sort((a, b) => b.lines - a.lines);

    // Get recent changes
    const recentCommits = await this.getRecentCommits(filePath, 5);
    const recentChanges = recentCommits.map((c) => ({
      commit: c.shortHash,
      author: c.author,
      date: c.date,
      summary: c.message,
      linesChanged: c.insertions + c.deletions,
    }));

    return {
      file: filePath,
      totalLines,
      authors,
      recentChanges,
    };
  }

  /**
   * Find commits that modified specific lines.
   */
  async findCommitsForLines(
    filePath: string,
    startLine: number,
    endLine: number,
  ): Promise<string[]> {
    const blameEntries = await this.blame(filePath, { startLine, endLine });
    const commits = new Set<string>();
    for (const entry of blameEntries) {
      commits.add(entry.commit);
    }
    return Array.from(commits);
  }

  /**
   * Check if a file was modified in a commit.
   * Returns false if the commit doesn't exist or there's an error checking.
   */
  async wasFileModified(commitHash: string, filePath: string): Promise<boolean> {
    try {
      const output = this.runGit(["diff-tree", "--no-commit-id", "--name-only", "-r", commitHash]);
      const files = output.split("\n").map((f) => f.trim());
      const relativePath = filePath.startsWith("/") ? relative(this.repoPath, filePath) : filePath;
      return files.includes(relativePath);
    } catch (err) {
      // Commit may not exist or file may not be tracked - this is expected in some cases
      // Log at debug level to avoid noise
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("bad object") && !msg.includes("not a git repository")) {
        // Only log unexpected errors
        console.debug(`[git-tools] wasFileModified(${commitHash}, ${filePath}) failed: ${msg}`);
      }
      return false;
    }
  }

  /**
   * Get diff for a specific commit.
   */
  async getCommitDiff(commitHash: string, filePath?: string): Promise<string> {
    const args = ["diff", `${commitHash}^`, commitHash];
    if (filePath) {
      args.push("--", filePath);
    }
    return this.runGit(args);
  }

  /**
   * Find commits matching a patch ID pattern (in commit messages).
   */
  async findPatchCommits(patchIdPattern: string): Promise<PatchCommitLink[]> {
    const args = ["log", "--all", "--format=%H|%aI|%s", `--grep=${patchIdPattern}`];
    const output = this.runGit(args);
    const links: PatchCommitLink[] = [];

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const [hash, dateStr, message] = line.split("|");

      // Extract patch ID from message
      const patchMatch = message.match(/patch[:\s]+([a-f0-9-]+)/i);
      if (patchMatch) {
        const commit = await this.getCommit(hash);
        links.push({
          patchId: patchMatch[1],
          commits: [hash],
          files: commit.files,
          timestamp: new Date(dateStr),
        });
      }
    }

    return links;
  }

  /**
   * Get files changed between two commits.
   */
  async getChangedFiles(fromCommit: string, toCommit: string): Promise<string[]> {
    const output = this.runGit(["diff", "--name-only", fromCommit, toCommit]);
    return output.split("\n").filter((f) => f.trim());
  }

  /**
   * Check if working directory is clean.
   */
  async isClean(): Promise<boolean> {
    const output = this.runGit(["status", "--porcelain"]);
    return output.trim() === "";
  }

  /**
   * Get current branch name.
   */
  async getCurrentBranch(): Promise<string> {
    return this.runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  }

  /**
   * Get current commit hash.
   */
  async getCurrentCommit(): Promise<string> {
    return this.runGit(["rev-parse", "HEAD"]);
  }
}

/**
 * Create a GitTools instance for the default repo path.
 */
export function createGitTools(repoPath?: string): GitTools {
  return new GitTools(repoPath ?? process.cwd());
}
