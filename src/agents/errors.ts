/**
 * Typed error classes for better error handling and debugging.
 *
 * Use these instead of generic Error for:
 * - Distinguishing retryable vs permanent failures
 * - Adding context to error messages
 * - Structured error handling in catch blocks
 */

/**
 * Base class for errors that may be retried.
 */
export class TransientError extends Error {
  readonly retryable = true;

  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "TransientError";
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Base class for errors that should not be retried.
 */
export class PermanentError extends Error {
  readonly retryable = false;

  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "PermanentError";
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Input validation failed.
 */
export class ValidationError extends PermanentError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown,
  ) {
    super(field ? `[${field}] ${message}` : message);
    this.name = "ValidationError";
  }
}

/**
 * Resource not found.
 */
export class NotFoundError extends PermanentError {
  constructor(
    public readonly resourceType: string,
    public readonly resourceId: string,
    public readonly searchedLocations?: string[],
  ) {
    const locations = searchedLocations?.length
      ? `\n  Searched: ${searchedLocations.join(", ")}`
      : "";
    super(`${resourceType} not found: ${resourceId}${locations}`);
    this.name = "NotFoundError";
  }
}

/**
 * Operation timed out.
 */
export class TimeoutError extends TransientError {
  constructor(
    public readonly operation: string,
    public readonly timeoutMs: number,
  ) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * External service call failed.
 */
export class ExternalServiceError extends Error {
  readonly retryable: boolean;

  constructor(
    public readonly service: string,
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string,
  ) {
    const statusInfo = statusCode ? ` (HTTP ${statusCode})` : "";
    super(`[${service}]${statusInfo} ${message}`);
    this.name = "ExternalServiceError";
    // 5xx and 429 are typically retryable
    this.retryable = statusCode ? statusCode >= 500 || statusCode === 429 : false;
  }
}

/**
 * Configuration error.
 */
export class ConfigurationError extends PermanentError {
  constructor(
    message: string,
    public readonly configPath?: string,
    public readonly expectedValue?: string,
  ) {
    const context = configPath ? ` (config path: ${configPath})` : "";
    super(`${message}${context}`);
    this.name = "ConfigurationError";
  }
}

/**
 * File system operation failed.
 */
export class FileSystemError extends Error {
  readonly retryable: boolean;

  constructor(
    public readonly operation: "read" | "write" | "delete" | "mkdir" | "stat" | "access",
    public readonly path: string,
    cause?: Error,
  ) {
    const causeMsg = cause ? `: ${cause.message}` : "";
    super(`Failed to ${operation} "${path}"${causeMsg}`);
    this.name = "FileSystemError";
    // Most FS errors are not retryable, except for EBUSY/EAGAIN
    const code = (cause as NodeJS.ErrnoException)?.code;
    this.retryable = code === "EBUSY" || code === "EAGAIN";
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Command execution failed.
 */
export class CommandError extends Error {
  readonly retryable = false;

  constructor(
    public readonly command: string,
    public readonly args: string[],
    public readonly exitCode: number | null,
    public readonly stderr?: string,
    public readonly stdout?: string,
    public readonly cwd?: string,
  ) {
    const cmdStr = `${command} ${args.join(" ")}`;
    const exitInfo = exitCode !== null ? `exit code ${exitCode}` : "killed";
    const stderrInfo = stderr?.trim() ? `\n  stderr: ${stderr.trim().slice(0, 500)}` : "";
    const cwdInfo = cwd ? `\n  cwd: ${cwd}` : "";
    super(`Command failed (${exitInfo}): ${cmdStr}${cwdInfo}${stderrInfo}`);
    this.name = "CommandError";
  }
}

/**
 * Check if an error is retryable.
 */
export function isRetryable(error: Error): boolean {
  // Check if error has retryable property
  if ("retryable" in error && typeof error.retryable === "boolean") {
    return error.retryable;
  }

  // Heuristic check based on message
  const msg = error.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("rate limit") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("429") ||
    msg.includes("503")
  );
}

/**
 * Format an error for logging with full context.
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) {
    const parts = [err.message];

    // Add cause chain
    let cause = (err as { cause?: unknown }).cause;
    while (cause instanceof Error) {
      parts.push(`  Caused by: ${cause.message}`);
      cause = (cause as { cause?: unknown }).cause;
    }

    return parts.join("\n");
  }
  return String(err);
}

/**
 * Format an error with stack trace for debugging.
 */
export function formatErrorWithStack(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  return String(err);
}

/**
 * Wrap an error with additional context.
 */
export function wrapError(err: unknown, context: string, ErrorClass: typeof Error = Error): Error {
  const originalError = err instanceof Error ? err : new Error(String(err));
  return new ErrorClass(`${context}: ${originalError.message}`, { cause: originalError });
}
