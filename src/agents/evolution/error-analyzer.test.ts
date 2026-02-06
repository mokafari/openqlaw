import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { ErrorAnalyzer } from "./error-analyzer.js";

describe("ErrorAnalyzer", () => {
  let workspaceDir: string;
  let analyzer: ErrorAnalyzer;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "error-analyzer-test-"));
    analyzer = new ErrorAnalyzer(workspaceDir);
  });

  it("should parse TypeScript error with file and line", async () => {
    const fileLine =
      "src/test.ts(120,15): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'";
    const surroundingLines = [fileLine];

    const error = await analyzer.parseTypeScriptError(fileLine, surroundingLines);

    expect(error).not.toBeNull();
    expect(error?.file).toBe("src/test.ts");
    expect(error?.line).toBe(120);
    expect(error?.column).toBe(15);
    expect(error?.code).toBe("TS2345");
    expect(error?.message).toContain("Argument of type");
  });

  it("should extract context from source file", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(workspaceDir, "src"), { recursive: true });
    const testFile = join(workspaceDir, "src", "test.ts");
    await writeFile(
      testFile,
      `line 1
line 2
line 3
line 4
line 5
line 6
line 7
line 8
line 9
line 10
line 11
line 12
line 13
line 14
line 15`,
      "utf-8",
    );

    const context = await analyzer.extractContext("src/test.ts", 10);

    expect(context).not.toBeNull();
    expect(context).toContain("line 10");
    expect(context).toContain("line 5"); // Before
    expect(context).toContain("line 15"); // After
  });

  it("should normalize error file paths", () => {
    const error = {
      file: join(workspaceDir, "src", "test.ts"),
      line: 10,
      column: 5,
      message: "Test error",
      code: "TS2345",
      context: "test context",
    };

    const normalized = analyzer.normalizeError(error);

    expect(normalized.file).toBe("src/test.ts");
    expect(normalized.message).toBe("Test error");
  });

  it("should parse multiple errors from build output", async () => {
    const buildOutput = `
src/file1.ts(10,5): error TS2345: Type error 1
src/file2.ts(20,10): error TS2304: Cannot find name 'x'
`;

    const errors = await analyzer.parseErrors(buildOutput);

    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors[0]?.code).toBe("TS2345");
    expect(errors[1]?.code).toBe("TS2304");
  });
});
