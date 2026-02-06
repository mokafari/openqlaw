import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasSoulChanged, loadSoul } from "./soul-loader.js";

describe("SoulLoader", () => {
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "quake-test-"));
    workspaceDir = path.join(tempDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("loadSoul", () => {
    it("should return null when SOUL.md does not exist", async () => {
      const soul = await loadSoul(workspaceDir);
      expect(soul).toBeNull();
    });

    it("should load SOUL.md when it exists", async () => {
      const soulPath = path.join(workspaceDir, "SOUL.md");
      await fs.writeFile(
        soulPath,
        `# Personality

## Traits
- Encouraging
- Brief

## Response Style
Brief and to the point.
`,
      );

      const soul = await loadSoul(workspaceDir);
      expect(soul).not.toBeNull();
      expect(soul?.content).toContain("Personality");
      expect(soul?.traits).toContain("encouraging");
      expect(soul?.traits).toContain("brief");
      expect(soul?.responseStyle).toBe("brief");
    });

    it("should extract traits from SOUL.md", async () => {
      const soulPath = path.join(workspaceDir, "SOUL.md");
      await fs.writeFile(
        soulPath,
        `## Traits
- Encouraging
- Resilient
- Helpful
`,
      );

      const soul = await loadSoul(workspaceDir);
      expect(soul?.traits).toContain("encouraging");
      expect(soul?.traits).toContain("resilient");
      expect(soul?.traits).toContain("helpful");
    });

    it("should detect response style from content", async () => {
      const soulPath = path.join(workspaceDir, "SOUL.md");
      await fs.writeFile(soulPath, "Be brief and concise.");

      const soul = await loadSoul(workspaceDir);
      expect(soul?.responseStyle).toBe("brief");
    });

    it("should detect detailed response style", async () => {
      const soulPath = path.join(workspaceDir, "SOUL.md");
      await fs.writeFile(soulPath, "Provide detailed explanations.");

      const soul = await loadSoul(workspaceDir);
      expect(soul?.responseStyle).toBe("detailed");
    });

    it("should include lastModified timestamp", async () => {
      const soulPath = path.join(workspaceDir, "SOUL.md");
      await fs.writeFile(soulPath, "Test content");

      const soul = await loadSoul(workspaceDir);
      expect(soul?.lastModified).toBeGreaterThan(0);
    });

    it("should provide default synonyms when SOUL.md has no synonyms", async () => {
      const soulPath = path.join(workspaceDir, "SOUL.md");
      await fs.writeFile(soulPath, "Test content");

      const soul = await loadSoul(workspaceDir);
      expect(soul?.synonyms).toBeDefined();
      expect(soul?.synonyms?.START_TOOL).toBeDefined();
    });
  });

  describe("hasSoulChanged", () => {
    it("should return true when lastModified is not provided", async () => {
      const changed = await hasSoulChanged(workspaceDir);
      expect(changed).toBe(true);
    });

    it("should return false when file does not exist", async () => {
      const changed = await hasSoulChanged(workspaceDir, Date.now());
      expect(changed).toBe(false);
    });

    it("should return true when file has been modified", async () => {
      const soulPath = path.join(workspaceDir, "SOUL.md");
      await fs.writeFile(soulPath, "Initial content");

      const stats1 = await fs.stat(soulPath);
      const lastModified = stats1.mtimeMs - 1000; // 1 second ago

      // Wait a bit and modify
      await new Promise((resolve) => setTimeout(resolve, 10));
      await fs.writeFile(soulPath, "Modified content");

      const changed = await hasSoulChanged(workspaceDir, lastModified);
      expect(changed).toBe(true);
    });

    it("should return false when file has not been modified", async () => {
      const soulPath = path.join(workspaceDir, "SOUL.md");
      await fs.writeFile(soulPath, "Test content");

      const stats = await fs.stat(soulPath);
      const lastModified = stats.mtimeMs;

      const changed = await hasSoulChanged(workspaceDir, lastModified);
      expect(changed).toBe(false);
    });
  });
});
