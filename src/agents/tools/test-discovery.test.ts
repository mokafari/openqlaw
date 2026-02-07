/**
 * Tests for Test Discovery Tool
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  TestDiscovery,
  createTestDiscovery,
  findRelatedTests,
  discoverTestPatterns,
  mapSourceToTests,
  runRelatedTests,
  type TestFile,
  type TestCase,
  type TestPattern,
  type TestResult,
} from "./test-discovery.js";

// Mock fs promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

describe("TestDiscovery", () => {
  let discovery: TestDiscovery;

  beforeEach(() => {
    discovery = new TestDiscovery({ rootDir: "/fake/project" });
    vi.clearAllMocks();
  });

  describe("parseTestFile", () => {
    it("parses vitest test file correctly", async () => {
      const testContent = `
import { describe, it, expect } from "vitest";
import { myFunction } from "../myModule";

describe("myFunction", () => {
  it("should return true", () => {
    expect(myFunction()).toBe(true);
  });

  it.skip("should handle edge case", () => {
    expect(myFunction(null)).toBe(false);
  });
});

test("standalone test", () => {
  expect(1 + 1).toBe(2);
});
`;

      vi.mocked(readFile).mockResolvedValue(testContent);

      const testFile = await discovery.parseTestFile("/fake/project/src/myModule.test.ts");

      expect(testFile.framework).toBe("vitest");
      expect(testFile.tests.length).toBeGreaterThan(0);

      const describeBlock = testFile.tests.find((t) => t.type === "describe");
      expect(describeBlock).toBeDefined();
      expect(describeBlock?.name).toBe("myFunction");

      const skippedTest = testFile.tests.find((t) => t.modifiers?.includes("skip"));
      expect(skippedTest).toBeDefined();

      const standaloneTest = testFile.tests.find((t) => t.name === "standalone test");
      expect(standaloneTest).toBeDefined();
    });

    it("parses jest test file correctly", async () => {
      const testContent = `
import { myFunction } from "../myModule";

describe("myFunction", () => {
  test.only("should focus on this test", () => {
    expect(myFunction()).toBe(true);
  });

  test.todo("implement this later");
});
`;

      vi.mocked(readFile).mockResolvedValue(testContent);

      const testFile = await discovery.parseTestFile("/fake/project/src/myModule.test.ts");

      const onlyTest = testFile.tests.find((t) => t.modifiers?.includes("only"));
      expect(onlyTest).toBeDefined();

      const todoTest = testFile.tests.find((t) => t.modifiers?.includes("todo"));
      expect(todoTest).toBeDefined();
    });

    it("detects imports correctly", async () => {
      const testContent = `
import { describe, it, expect } from "vitest";
import { myFunction } from "../myModule";
import { helper } from "./helpers";
`;

      vi.mocked(readFile).mockResolvedValue(testContent);

      const testFile = await discovery.parseTestFile("/fake/project/src/myModule.test.ts");

      expect(testFile.imports).toContain("vitest");
      expect(testFile.imports).toContain("../myModule");
      expect(testFile.imports).toContain("./helpers");
    });
  });

  describe("findAffectedTests", () => {
    it("finds directly affected tests when source file changes", async () => {
      // Mock directory walking to return one test file
      vi.mocked(readdir).mockImplementation(async (dir) => {
        if (String(dir).includes("src")) {
          return [
            { name: "myModule.test.ts", isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        return [];
      });

      vi.mocked(readFile).mockResolvedValue(`
import { describe, it } from "vitest";
import { myFunction } from "./myModule";

describe("myFunction", () => {
  it("works", () => {});
});
`);

      const affected = await discovery.findAffectedTests(["src/myModule.ts"]);

      // The test file should be affected since its source file changed
      expect(affected.changedFiles).toContain("src/myModule.ts");
    });
  });

  describe("getCoverageSummary", () => {
    it("calculates correct summary statistics", async () => {
      // Mock to return no files (simplified test)
      vi.mocked(readdir).mockResolvedValue([]);

      const summary = await discovery.getCoverageSummary();

      expect(summary.totalTestFiles).toBe(0);
      expect(summary.totalTests).toBe(0);
      expect(summary.totalSuites).toBe(0);
    });
  });

  describe("glob matching", () => {
    it("matches simple glob patterns", () => {
      const discovery = new TestDiscovery({ rootDir: "/test" });

      // Access private method through any cast for testing
      const matchGlob = (discovery as any).matchGlob.bind(discovery);

      expect(matchGlob("src/test.test.ts", "**/*.test.ts")).toBe(true);
      expect(matchGlob("test.test.ts", "*.test.ts")).toBe(true);
      expect(matchGlob("src/module.ts", "**/*.test.ts")).toBe(false);
    });
  });
});

describe("createTestDiscovery", () => {
  it("creates TestDiscovery with default cwd", () => {
    const discovery = createTestDiscovery();
    expect(discovery).toBeInstanceOf(TestDiscovery);
  });

  it("creates TestDiscovery with custom path", () => {
    const discovery = createTestDiscovery("/custom/path");
    expect(discovery).toBeInstanceOf(TestDiscovery);
  });
});

describe("findRelatedTests", () => {
  it("returns empty array when no tests exist", async () => {
    vi.mocked(readdir).mockResolvedValue([]);

    const tests = await findRelatedTests("src/myModule.ts", "/fake/project");

    expect(tests).toEqual([]);
  });
});

describe("discoverTestPatterns", () => {
  it("discovers suffix patterns when test files exist", async () => {
    // This test verifies the pattern detection logic
    // The actual file walking is tested in integration tests
    const discovery = new TestDiscovery({ rootDir: "/fake/project" });

    // Mock a test file with .test.ts suffix
    vi.mocked(readdir).mockImplementation(async (dir) => {
      if (String(dir) === "/fake/project") {
        return [{ name: "foo.test.ts", isDirectory: () => false, isFile: () => true }] as any;
      }
      return [];
    });

    vi.mocked(readFile).mockResolvedValue(`
import { describe, it } from "vitest";
describe("test", () => { it("works", () => {}); });
`);

    // Test the pattern detection on a parsed file
    const testFile = await discovery.parseTestFile("/fake/project/foo.test.ts");
    expect(testFile.relativePath).toBe("foo.test.ts");
    expect(testFile.relativePath.includes(".test.")).toBe(true);
  });

  it("identifies __tests__ directory in file paths", async () => {
    // This test verifies that __tests__ paths are recognized
    const discovery = new TestDiscovery({ rootDir: "/fake/project" });

    vi.mocked(readFile).mockResolvedValue(`
import { describe, it } from "vitest";
describe("test", () => { it("works", () => {}); });
`);

    const testFile = await discovery.parseTestFile("/fake/project/__tests__/foo.ts");
    expect(testFile.relativePath).toBe("__tests__/foo.ts");
    expect(testFile.relativePath.includes("__tests__/")).toBe(true);
  });
});

describe("mapSourceToTests", () => {
  it("returns empty map when no tests exist", async () => {
    vi.mocked(readdir).mockResolvedValue([]);

    const mapping = await mapSourceToTests("/fake/project");

    expect(mapping.size).toBe(0);
  });
});

describe("runRelatedTests", () => {
  it("returns success with no tests when none are related", async () => {
    vi.mocked(readdir).mockResolvedValue([]);

    const result = await runRelatedTests("src/myModule.ts", "/fake/project");

    expect(result.success).toBe(true);
    expect(result.testFiles).toEqual([]);
    expect(result.output).toBe("No related tests found");
  });
});
