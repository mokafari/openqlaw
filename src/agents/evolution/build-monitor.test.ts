import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { BuildMonitor } from "./build-monitor.js";

describe("BuildMonitor", () => {
  let workspaceDir: string;
  let monitor: BuildMonitor;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "build-monitor-test-"));
    monitor = new BuildMonitor(workspaceDir);
  });

  it("should detect TypeScript errors", async () => {
    const output = "src/test.ts(10,5): error TS2345: Argument of type 'string' is not assignable";

    const result = await monitor.watchBuild(output);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.code).toBe("TS2345");
    expect(result.errors[0]?.file).toContain("test.ts");
  });

  it("should detect build failed messages", async () => {
    const output = "Build failed with 3 errors";

    const result = await monitor.watchBuild(output);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.code).toBe("BUILD_FAILED");
  });

  it("should check if build is successful", async () => {
    // Create entry file
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(workspaceDir, "dist"), { recursive: true });
    const entryFile = join(workspaceDir, "dist", "entry.js");
    await writeFile(entryFile, "// test", "utf-8");

    expect(monitor.isBuildSuccessful()).toBe(true);
  });

  it("should reset monitor state", () => {
    monitor.reset();
    expect(monitor.getOutput()).toBe("");
  });
});
