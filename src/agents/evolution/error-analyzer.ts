import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type ParsedError = {
  file: string;
  line: number;
  column: number;
  message: string;
  code: string;
  context: string;
};

/**
 * ErrorAnalyzer: Parse TypeScript compiler output into structured error objects.
 */
export class ErrorAnalyzer {
  private readonly workspaceDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  /**
   * Parse TypeScript error from compiler output line.
   */
  async parseTypeScriptError(
    line: string,
    surroundingLines: string[] = [],
  ): Promise<ParsedError | null> {
    // Pattern: error TS2345: Argument of type 'string' is not assignable...
    const tsErrorMatch = line.match(/error\s+(TS\d+):\s*(.+)/i);
    if (!tsErrorMatch) {
      return null;
    }

    const code = tsErrorMatch[1];
    const message = tsErrorMatch[2].trim();

    // Try to find file and line number
    let file: string | undefined;
    let lineNum: number | undefined;
    let column: number | undefined;

    // Check surrounding lines for file path
    for (const checkLine of [...surroundingLines, line]) {
      // Pattern: src/file.ts(120,15): error...
      const fileMatch = checkLine.match(/^(.+\.ts(?:x)?)\((\d+),(\d+)\):/);
      if (fileMatch) {
        file = fileMatch[1];
        lineNum = parseInt(fileMatch[2], 10);
        column = parseInt(fileMatch[3], 10);
        break;
      }

      // Pattern: src/file.ts:120:15 - error...
      const fileMatch2 = checkLine.match(/^(.+\.ts(?:x)?):(\d+):(\d+)\s*-/);
      if (fileMatch2) {
        file = fileMatch2[1];
        lineNum = parseInt(fileMatch2[2], 10);
        column = parseInt(fileMatch2[3], 10);
        break;
      }
    }

    // If file found, extract context
    let context = surroundingLines.join("\n");
    if (file && lineNum) {
      const fileContext = await this.extractContext(file, lineNum);
      if (fileContext) {
        context = fileContext;
      }
    }

    return {
      file: file ?? "unknown",
      line: lineNum ?? 0,
      column: column ?? 0,
      message,
      code,
      context,
    };
  }

  /**
   * Extract context from source file (10 lines before/after).
   */
  async extractContext(file: string, line: number): Promise<string | null> {
    try {
      // Resolve file path relative to workspace
      const filePath = file.startsWith("/") ? file : join(this.workspaceDir, file);

      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");

      const start = Math.max(0, line - 11); // 0-indexed, so line-1 is the actual line
      const end = Math.min(lines.length, line + 10);

      const contextLines = lines.slice(start, end);
      const contextWithNumbers = contextLines.map((l, i) => {
        const lineNum = start + i + 1;
        const marker = lineNum === line ? " >" : "  ";
        return `${marker} ${lineNum.toString().padStart(4)} | ${l}`;
      });

      return contextWithNumbers.join("\n");
    } catch (err) {
      // File might not exist or be unreadable
      return null;
    }
  }

  /**
   * Normalize error format for consistent handling.
   */
  normalizeError(error: ParsedError): ParsedError {
    // Ensure file path is relative to workspace
    let normalizedFile = error.file;
    if (normalizedFile.startsWith(this.workspaceDir)) {
      normalizedFile = normalizedFile.slice(this.workspaceDir.length + 1);
    }

    return {
      ...error,
      file: normalizedFile,
      message: error.message.trim(),
      context: error.context.trim(),
    };
  }

  /**
   * Parse multiple errors from build output.
   */
  async parseErrors(buildOutput: string): Promise<ParsedError[]> {
    const errors: ParsedError[] = [];
    const lines = buildOutput.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const surroundingLines = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 6));

      const error = await this.parseTypeScriptError(line, surroundingLines);
      if (error) {
        errors.push(this.normalizeError(error));
      }
    }

    return errors;
  }
}
