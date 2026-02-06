import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ParsedError } from "./error-analyzer.js";

export type BuildResult = {
  success: boolean;
  errors: ParsedError[];
  logs: string;
  timestamp: number;
  exitCode: number | null;
};

/**
 * BuildMonitor: Captures and detects build failures from tsdown output.
 */
export class BuildMonitor {
  private readonly workspaceDir: string;
  private buildOutput: string = "";
  private errors: ParsedError[] = [];

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  /**
   * Monitor build process output and detect failures.
   */
  async watchBuild(output: string): Promise<BuildResult> {
    this.buildOutput += output;
    this.errors = this.detectFailurePattern(this.buildOutput);

    return {
      success: this.errors.length === 0 && this.isBuildSuccessful(),
      errors: this.errors,
      logs: this.buildOutput,
      timestamp: Date.now(),
      exitCode: null, // Will be set by caller
    };
  }

  /**
   * Check if build completed successfully.
   */
  isBuildSuccessful(): boolean {
    const entryFile = join(this.workspaceDir, "dist", "entry.js");
    return existsSync(entryFile);
  }

  /**
   * Detect build failure patterns in output.
   */
  detectFailurePattern(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const lines = output.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // TypeScript error pattern: error TS2345: Argument of type...
      const tsErrorMatch = line.match(/error\s+(TS\d+):\s*(.+)/i);
      if (tsErrorMatch) {
        const code = tsErrorMatch[1];
        const message = tsErrorMatch[2];

        // Try to find file and line number in previous or current lines
        let file: string | undefined;
        let lineNum: number | undefined;
        let column: number | undefined;

        // Look backwards for file path
        for (let j = i; j >= Math.max(0, i - 5); j--) {
          const fileMatch = lines[j].match(/^(.+\.ts(?:x)?)\((\d+),(\d+)\):/);
          if (fileMatch) {
            file = fileMatch[1];
            lineNum = parseInt(fileMatch[2], 10);
            column = parseInt(fileMatch[3], 10);
            break;
          }
        }

        // If no file found, try to extract from error message
        if (!file) {
          const fileInMessage = message.match(/^(.+\.ts(?:x)?)\((\d+),(\d+)\)/);
          if (fileInMessage) {
            file = fileInMessage[1];
            lineNum = parseInt(fileInMessage[2], 10);
            column = parseInt(fileInMessage[3], 10);
          }
        }

        errors.push({
          file: file ?? "unknown",
          line: lineNum ?? 0,
          column: column ?? 0,
          message: message.trim(),
          code,
          context: this.extractContext(lines, i),
        });
      }

      // Build failed pattern
      const buildFailedMatch = line.match(/Build failed with (\d+) errors?/i);
      if (buildFailedMatch && errors.length === 0) {
        // Generic build failure if no specific errors found
        errors.push({
          file: "unknown",
          line: 0,
          column: 0,
          message: `Build failed with ${buildFailedMatch[1]} errors`,
          code: "BUILD_FAILED",
          context: this.extractContext(lines, i),
        });
      }
    }

    return errors;
  }

  /**
   * Extract context around error line (10 lines before/after).
   */
  private extractContext(lines: string[], errorLineIndex: number): string {
    const start = Math.max(0, errorLineIndex - 10);
    const end = Math.min(lines.length, errorLineIndex + 11);
    return lines.slice(start, end).join("\n");
  }

  /**
   * Reset monitor state for new build.
   */
  reset(): void {
    this.buildOutput = "";
    this.errors = [];
  }

  /**
   * Get current build output.
   */
  getOutput(): string {
    return this.buildOutput;
  }
}
