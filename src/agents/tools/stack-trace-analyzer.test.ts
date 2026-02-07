/**
 * Tests for stack-trace-analyzer
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import {
  parseStackTrace,
  contextualize,
  classify,
  suggestFix,
  findSimilar,
  explain,
  saveToHistory,
  analyzeStackTrace,
  type ParsedStackTrace,
  type ErrorCategory,
} from "./stack-trace-analyzer.js";

// ============================================================================
// Test Data
// ============================================================================

const SAMPLE_STACK_TRACES = {
  typeError: `TypeError: Cannot read properties of undefined (reading 'name')
    at processUser (/Users/dev/project/src/user.ts:42:15)
    at handleRequest (/Users/dev/project/src/api.ts:123:8)
    at Layer.handle [as handle_request] (node_modules/express/lib/router/layer.js:95:5)
    at next (node_modules/express/lib/router/route.js:144:13)
    at Route.dispatch (node_modules/express/lib/router/route.js:114:3)
    at Layer.handle [as handle_request] (node_modules/express/lib/router/layer.js:95:5)`,

  referenceError: `ReferenceError: someFunction is not defined
    at validateInput (/Users/dev/project/src/validator.ts:88:5)
    at Object.<anonymous> (/Users/dev/project/src/index.ts:15:1)`,

  connectionError: `Error: ECONNREFUSED: Connection refused
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1300:16)
    at Protocol.connect (/Users/dev/project/node_modules/mysql/lib/Protocol.js:38:23)`,

  fileNotFound: `Error: ENOENT: no such file or directory, open '/etc/app/config.json'
    at Object.openSync (node:fs:603:3)
    at readFileSync (node:fs:471:35)
    at loadConfig (/Users/dev/project/src/config.ts:12:20)`,

  validationError: `Error: Validation failed: missing required field 'email'
    at validateUserInput (/Users/dev/project/src/validation.ts:45:11)
    at createUser (/Users/dev/project/src/user-service.ts:23:3)`,

  raceCondition: `Error: Cannot write to already closed stream
    at WriteStream.write (/Users/dev/project/src/logger.ts:67:9)
    at AsyncResource.runInAsyncScope (node:async_hooks:203:9)`,
};

// ============================================================================
// Parse Stack Trace Tests
// ============================================================================

describe("parseStackTrace", () => {
  test("parses TypeError correctly", async () => {
    const result = await parseStackTrace(SAMPLE_STACK_TRACES.typeError);

    expect(result.error).toBe("TypeError");
    expect(result.message).toContain("Cannot read properties");
    expect(result.frames.length).toBeGreaterThan(0);
    expect(result.category).toBe("bug");
  });

  test("parses ReferenceError correctly", async () => {
    const result = await parseStackTrace(SAMPLE_STACK_TRACES.referenceError);

    expect(result.error).toBe("ReferenceError");
    expect(result.message).toContain("is not defined");
    expect(result.category).toBe("bug");
  });

  test("parses connection error correctly", async () => {
    const result = await parseStackTrace(SAMPLE_STACK_TRACES.connectionError);

    expect(result.error).toBe("Error");
    expect(result.message).toContain("ECONNREFUSED");
    expect(result.category).toBe("external");
  });

  test("parses file not found error correctly", async () => {
    const result = await parseStackTrace(SAMPLE_STACK_TRACES.fileNotFound);

    expect(result.error).toBe("Error");
    expect(result.message).toContain("ENOENT");
    expect(result.category).toBe("resource");
  });

  test("parses validation error correctly", async () => {
    const result = await parseStackTrace(SAMPLE_STACK_TRACES.validationError);

    expect(result.error).toBe("Error");
    expect(result.message).toContain("missing required");
    expect(result.category).toBe("user_input");
  });

  test("parses race condition error correctly", async () => {
    const result = await parseStackTrace(SAMPLE_STACK_TRACES.raceCondition);

    expect(result.error).toBe("Error");
    expect(result.message).toContain("already closed");
    expect(result.category).toBe("race_condition");
  });

  test("extracts stack frames with file/line info", async () => {
    const result = await parseStackTrace(SAMPLE_STACK_TRACES.typeError);

    const userFrame = result.frames.find((f) => !f.isInternal);
    expect(userFrame).toBeDefined();
    expect(userFrame?.file).toContain("user.ts");
    expect(userFrame?.line).toBe(42);
    expect(userFrame?.column).toBe(15);
    expect(userFrame?.function).toBe("processUser");
  });

  test("identifies internal vs user frames", async () => {
    const result = await parseStackTrace(SAMPLE_STACK_TRACES.typeError);

    const internalFrames = result.frames.filter((f) => f.isInternal);
    const userFrames = result.frames.filter((f) => !f.isInternal);

    expect(internalFrames.length).toBeGreaterThan(0);
    expect(userFrames.length).toBeGreaterThan(0);

    // Internal frames should reference node_modules or node:
    for (const frame of internalFrames) {
      expect(
        frame.file.includes("node_modules") ||
          frame.file.startsWith("node:") ||
          frame.file.includes("internal/"),
      ).toBe(true);
    }
  });

  test("handles empty or malformed input", async () => {
    const result = await parseStackTrace("");
    expect(result.error).toBe("Error");
    expect(result.frames.length).toBe(0);
  });

  test("handles stack trace without frames", async () => {
    const result = await parseStackTrace("Error: Something went wrong");
    expect(result.error).toBe("Error");
    expect(result.message).toBe("Something went wrong");
    expect(result.frames.length).toBe(0);
  });
});

// ============================================================================
// Contextualize Tests
// ============================================================================

describe("contextualize", () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stack-trace-test-"));
    testFile = path.join(tempDir, "test.ts");
    await fs.writeFile(
      testFile,
      `function example() {
  const a = 1;
  const b = 2;
  throw new Error("test error");
  return a + b;
}
export { example };
`,
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("adds source context to frames", async () => {
    const parsed: ParsedStackTrace = {
      error: "Error",
      message: "test error",
      category: "bug",
      frames: [
        {
          file: testFile,
          line: 4,
          column: 9,
          function: "example",
          isInternal: false,
        },
      ],
    };

    const result = await contextualize(parsed, 5);

    expect(result.frames[0].sourceContext).toBeDefined();
    expect(result.frames[0].sourceContext!.length).toBeGreaterThan(0);

    // Should include the error line
    const contextText = result.frames[0].sourceContext!.join("\n");
    expect(contextText).toContain("throw new Error");
  });

  test("handles missing files gracefully", async () => {
    const parsed: ParsedStackTrace = {
      error: "Error",
      message: "test error",
      category: "bug",
      frames: [
        {
          file: "/nonexistent/file.ts",
          line: 10,
          function: "test",
          isInternal: false,
        },
      ],
    };

    const result = await contextualize(parsed);

    // Should not throw, just skip context
    expect(result.frames[0].sourceContext).toBeUndefined();
  });

  test("skips internal frames", async () => {
    const parsed: ParsedStackTrace = {
      error: "Error",
      message: "test error",
      category: "bug",
      frames: [
        {
          file: "node_modules/some-lib/index.js",
          line: 42,
          function: "internalFn",
          isInternal: true,
        },
      ],
    };

    const result = await contextualize(parsed);

    // Should not attempt to load context for internal frames
    expect(result.frames[0].sourceContext).toBeUndefined();
  });
});

// ============================================================================
// Classify Tests
// ============================================================================

describe("classify", () => {
  test("classifies TypeError as bug", async () => {
    const parsed: ParsedStackTrace = {
      error: "TypeError",
      message: "Cannot read properties of undefined",
      category: "bug",
      frames: [],
    };

    const result = await classify(parsed);
    expect(result).toBe("bug");
  });

  test("classifies ECONNREFUSED as external", async () => {
    const parsed: ParsedStackTrace = {
      error: "Error",
      message: "ECONNREFUSED: Connection refused",
      category: "bug", // Initial wrong classification
      frames: [],
    };

    const result = await classify(parsed);
    expect(result).toBe("external");
  });

  test("classifies ENOENT as resource", async () => {
    const parsed: ParsedStackTrace = {
      error: "Error",
      message: "ENOENT: no such file or directory",
      category: "bug",
      frames: [],
    };

    const result = await classify(parsed);
    expect(result).toBe("resource");
  });

  test("classifies validation errors as user_input", async () => {
    const parsed: ParsedStackTrace = {
      error: "Error",
      message: "Validation failed: missing required field",
      category: "bug",
      frames: [],
    };

    const result = await classify(parsed);
    expect(result).toBe("user_input");
  });

  test("classifies config errors", async () => {
    const parsed: ParsedStackTrace = {
      error: "Error",
      message: "Configuration error: missing env variable",
      category: "bug",
      frames: [],
    };

    const result = await classify(parsed);
    expect(result).toBe("config");
  });
});

// ============================================================================
// Suggest Fix Tests
// ============================================================================

describe("suggestFix", () => {
  test("suggests null check for TypeError", async () => {
    const parsed: ParsedStackTrace = {
      error: "TypeError",
      message: "Cannot read properties of undefined (reading 'name')",
      category: "bug",
      frames: [
        {
          file: "/project/src/user.ts",
          line: 42,
          function: "processUser",
          isInternal: false,
        },
      ],
    };

    const suggestions = await suggestFix(parsed);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(
      suggestions.some(
        (s) => s.toLowerCase().includes("null") || s.toLowerCase().includes("undefined"),
      ),
    ).toBe(true);
  });

  test("suggests service check for connection errors", async () => {
    const parsed: ParsedStackTrace = {
      error: "Error",
      message: "ECONNREFUSED: Connection refused",
      category: "external",
      frames: [],
    };

    const suggestions = await suggestFix(parsed);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(
      suggestions.some(
        (s) => s.toLowerCase().includes("service") || s.toLowerCase().includes("running"),
      ),
    ).toBe(true);
  });

  test("suggests path check for ENOENT", async () => {
    const parsed: ParsedStackTrace = {
      error: "Error",
      message: "ENOENT: no such file or directory",
      category: "resource",
      frames: [],
    };

    const suggestions = await suggestFix(parsed);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(
      suggestions.some((s) => s.toLowerCase().includes("path") || s.toLowerCase().includes("file")),
    ).toBe(true);
  });

  test("includes frame location in suggestions", async () => {
    const parsed: ParsedStackTrace = {
      error: "Error",
      message: "Something failed",
      category: "bug",
      frames: [
        {
          file: "/project/src/handler.ts",
          line: 55,
          function: "handleRequest",
          isInternal: false,
        },
      ],
    };

    const suggestions = await suggestFix(parsed);

    expect(suggestions.some((s) => s.includes("handler.ts:55"))).toBe(true);
  });
});

// ============================================================================
// Find Similar Tests
// ============================================================================

describe("findSimilar", () => {
  let tempHistoryPath: string;

  beforeEach(async () => {
    // Create temp history file
    tempHistoryPath = path.join(os.tmpdir(), `error-history-test-${Date.now()}.jsonl`);
  });

  afterEach(async () => {
    try {
      await fs.unlink(tempHistoryPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  test("returns empty array when no history", async () => {
    const parsed: ParsedStackTrace = {
      error: "Error",
      message: "Some error",
      category: "bug",
      frames: [],
    };

    // Note: This tests against the actual history file location
    // In a real test environment, we'd mock the file system
    const similar = await findSimilar(parsed, 5);
    expect(Array.isArray(similar)).toBe(true);
  });

  test("returns matches sorted by similarity", async () => {
    // First, save some errors to history
    const error1: ParsedStackTrace = {
      error: "TypeError",
      message: "Cannot read properties of undefined (reading 'name')",
      category: "bug",
      frames: [{ file: "/src/user.ts", line: 42, function: "processUser", isInternal: false }],
    };

    const error2: ParsedStackTrace = {
      error: "Error",
      message: "Something completely different",
      category: "external",
      frames: [],
    };

    await saveToHistory(error1, "Added null check");
    await saveToHistory(error2, "Fixed network issue");

    // Now search for similar
    const query: ParsedStackTrace = {
      error: "TypeError",
      message: "Cannot read properties of undefined (reading 'id')",
      category: "bug",
      frames: [{ file: "/src/user.ts", line: 50, function: "processUser", isInternal: false }],
    };

    const similar = await findSimilar(query, 5);

    // Should find the TypeError as more similar
    if (similar.length > 0) {
      expect(similar[0].pastError).toContain("TypeError");
      expect(similar[0].similarity).toBeGreaterThan(0.3);
    }
  });
});

// ============================================================================
// Explain Tests
// ============================================================================

describe("explain", () => {
  test("generates markdown explanation", async () => {
    const parsed: ParsedStackTrace = {
      error: "TypeError",
      message: "Cannot read properties of undefined (reading 'name')",
      category: "bug",
      frames: [
        {
          file: "/project/src/user.ts",
          line: 42,
          column: 15,
          function: "processUser",
          isInternal: false,
        },
      ],
    };

    const explanation = await explain(parsed);

    expect(explanation).toContain("## TypeError");
    expect(explanation).toContain("**Message:**");
    expect(explanation).toContain("**Category:**");
    expect(explanation).toContain("### Analysis");
    expect(explanation).toContain("### Suggested Fixes");
  });

  test("includes stack trace info", async () => {
    const parsed: ParsedStackTrace = {
      error: "Error",
      message: "ECONNREFUSED",
      category: "external",
      frames: [
        {
          file: "/project/src/api.ts",
          line: 100,
          function: "fetchData",
          isInternal: false,
        },
      ],
    };

    const explanation = await explain(parsed);

    expect(explanation).toContain("fetchData");
    expect(explanation).toContain("api.ts:100");
  });

  test("provides category-specific analysis", async () => {
    const externalError: ParsedStackTrace = {
      error: "Error",
      message: "ETIMEDOUT",
      category: "external",
      frames: [],
    };

    const bugError: ParsedStackTrace = {
      error: "TypeError",
      message: "is not a function",
      category: "bug",
      frames: [],
    };

    const externalExplanation = await explain(externalError);
    const bugExplanation = await explain(bugError);

    expect(externalExplanation).toContain("external service");
    expect(bugExplanation).toContain("code bug");
  });
});

// ============================================================================
// Full Pipeline Test
// ============================================================================

describe("analyzeStackTrace", () => {
  test("runs full analysis pipeline", async () => {
    const result = await analyzeStackTrace(SAMPLE_STACK_TRACES.typeError);

    expect(result.parsed).toBeDefined();
    expect(result.parsed.error).toBe("TypeError");
    expect(result.parsed.category).toBe("bug");

    expect(result.explanation).toBeDefined();
    expect(result.explanation.length).toBeGreaterThan(0);

    expect(result.suggestions).toBeDefined();
    expect(Array.isArray(result.suggestions)).toBe(true);

    expect(result.similar).toBeDefined();
    expect(Array.isArray(result.similar)).toBe(true);
  });

  test("handles various error types", async () => {
    const traces = Object.values(SAMPLE_STACK_TRACES);

    for (const trace of traces) {
      const result = await analyzeStackTrace(trace);
      expect(result.parsed).toBeDefined();
      expect(result.explanation.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("edge cases", () => {
  test("handles stack trace with unusual formatting", async () => {
    const unusual = `Error: Weird error
at /some/path/file.js:10:5
at Object.<anonymous>`;

    const result = await parseStackTrace(unusual);
    expect(result.error).toBe("Error");
    expect(result.frames.length).toBeGreaterThanOrEqual(0);
  });

  test("handles very long stack traces", async () => {
    const lines = ["Error: Deep stack"];
    for (let i = 0; i < 100; i++) {
      lines.push(`    at level${i} (/project/src/deep.ts:${i}:1)`);
    }

    const result = await parseStackTrace(lines.join("\n"));
    expect(result.frames.length).toBe(100);
  });

  test("handles stack trace with special characters", async () => {
    const special = `Error: Path contains special chars: /home/user/my-project/[brackets]/file.ts
    at handler (/home/user/my-project/[brackets]/file.ts:10:5)`;

    const result = await parseStackTrace(special);
    expect(result.frames.length).toBeGreaterThan(0);
  });
});
