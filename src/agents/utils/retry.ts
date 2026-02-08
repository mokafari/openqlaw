/**
 * Retry utility with exponential backoff for transient failures.
 *
 * Usage:
 *   await withRetry(() => fetchData(), { maxRetries: 3 });
 */

import { log } from "../pi-embedded-runner/logger.js";

export type RetryOptions = {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Custom function to determine if error is retryable */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** Callback on each retry attempt */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
  /** Operation name for logging */
  operationName?: string;
};

const TRANSIENT_ERROR_PATTERNS = [
  "timeout",
  "timedout",
  "timed out",
  "econnreset",
  "econnrefused",
  "enotfound",
  "enetunreach",
  "rate limit",
  "too many requests",
  "429",
  "502",
  "503",
  "504",
  "service unavailable",
  "gateway timeout",
  "temporarily unavailable",
] as const;

/**
 * Check if an error is likely transient and should be retried.
 */
export function isTransientError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  shouldRetry: isTransientError,
};

/**
 * Execute an operation with automatic retry on transient failures.
 *
 * @param operation - Async function to execute
 * @param options - Retry configuration
 * @returns Result of the operation
 * @throws Last error if all retries fail
 *
 * @example
 * ```typescript
 * const data = await withRetry(
 *   () => fetch(url).then(r => r.json()),
 *   {
 *     maxRetries: 3,
 *     operationName: "fetch-user-data",
 *     onRetry: (err, attempt) => {
 *       log.warn(`Retry ${attempt}: ${err.message}`);
 *     }
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Last attempt - don't retry
      if (attempt > opts.maxRetries) {
        break;
      }

      // Check if we should retry this error
      if (opts.shouldRetry && !opts.shouldRetry(lastError, attempt)) {
        log.debug(
          `[retry] ${opts.operationName ?? "operation"}: Error not retryable: ${lastError.message}`,
        );
        break;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = opts.baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = 0.5 + Math.random() * 0.5; // 50-100% of calculated delay
      const delay = Math.min(exponentialDelay * jitter, opts.maxDelayMs);

      // Call retry callback
      opts.onRetry?.(lastError, attempt, delay);

      // Default logging if no callback provided
      if (!opts.onRetry) {
        log.debug(
          `[retry] ${opts.operationName ?? "operation"}: Attempt ${attempt} failed, ` +
            `retrying in ${Math.round(delay)}ms: ${lastError.message}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Enhance error with retry context
  const enhancedError = new Error(
    `${opts.operationName ?? "Operation"} failed after ${opts.maxRetries + 1} attempts: ${lastError?.message}`,
    { cause: lastError },
  );
  throw enhancedError;
}

/**
 * Create a retryable version of an async function.
 *
 * @example
 * ```typescript
 * const retryableFetch = retryable(
 *   (url: string) => fetch(url),
 *   { maxRetries: 3, operationName: "http-fetch" }
 * );
 *
 * const response = await retryableFetch("https://api.example.com/data");
 * ```
 */
export function retryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: Partial<RetryOptions> = {},
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}

/**
 * Retry with a circuit breaker pattern.
 * After consecutive failures exceed threshold, fast-fail for a cooldown period.
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private isOpen = false;

  constructor(
    private readonly options: {
      /** Failures before opening circuit */
      failureThreshold: number;
      /** Cooldown period in milliseconds */
      cooldownMs: number;
      /** Name for logging */
      name: string;
    },
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.isOpen) {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure < this.options.cooldownMs) {
        throw new Error(
          `[${this.options.name}] Circuit breaker open. ` +
            `Retry after ${Math.round((this.options.cooldownMs - timeSinceFailure) / 1000)}s`,
        );
      }
      // Half-open: allow one request through
      log.info(`[${this.options.name}] Circuit breaker half-open, attempting request`);
    }

    try {
      const result = await operation();
      // Success - reset failures
      if (this.isOpen) {
        log.info(`[${this.options.name}] Circuit breaker closed after successful request`);
      }
      this.failures = 0;
      this.isOpen = false;
      return result;
    } catch (err) {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.options.failureThreshold) {
        this.isOpen = true;
        log.warn(
          `[${this.options.name}] Circuit breaker opened after ${this.failures} failures. ` +
            `Cooldown: ${this.options.cooldownMs / 1000}s`,
        );
      }

      throw err;
    }
  }

  /** Get current circuit state */
  getState(): "closed" | "open" | "half-open" {
    if (!this.isOpen) return "closed";
    if (Date.now() - this.lastFailureTime >= this.options.cooldownMs) return "half-open";
    return "open";
  }

  /** Reset the circuit breaker */
  reset(): void {
    this.failures = 0;
    this.isOpen = false;
    this.lastFailureTime = 0;
  }
}
