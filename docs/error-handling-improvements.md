# Error Handling Hardening Analysis

**Date**: 2026-02-08
**Status**: Analysis Complete - Proposals Ready

## Executive Summary

Analysis of `/src/agents/evolution/` and `/src/agents/tools/` reveals several patterns that reduce debuggability and reliability. This document proposes specific improvements.

---

## 1. Silent Error Swallowing (Critical)

### Problem

Many catch blocks return default values without logging, making debugging difficult.

### Affected Files

**High Priority:**

- `patches.ts` - 8 bare catch blocks
- `meta-learning.ts` - 6 bare catch blocks
- `reflexion.ts` - 4 bare catch blocks
- `algorithm-distillation.ts` - 4 bare catch blocks
- `build-incremental.ts` - 10 bare catch blocks

### Example - Current (patches.ts:108)

```typescript
try {
  const content = await fs.readFile(patchFile, "utf-8");
  return JSON.parse(content) as Patch;
} catch {
  // Continue searching
}
```

### Proposed Fix

```typescript
try {
  const content = await fs.readFile(patchFile, "utf-8");
  return JSON.parse(content) as Patch;
} catch (err) {
  // Expected: file may not exist in this status directory
  // Only log at debug level to avoid noise during normal operation
  log.debug(
    `[patches] loadPatch: ${patchId} not in ${status}: ${err instanceof Error ? err.message : String(err)}`,
  );
}
```

### Example - Current (meta-learning.ts:258)

```typescript
} catch {
  return [];
}
```

### Proposed Fix

```typescript
} catch (err) {
  log.debug(`[meta-learning] loadPredictions failed: ${err instanceof Error ? err.message : String(err)}`);
  return [];
}
```

---

## 2. Error Messages Lacking Context (High)

### Problem

Error messages don't include enough information for debugging.

### Example - Current (git-tools.ts:100)

```typescript
throw new Error(`Git command failed: ${error.stderr ?? error.message}`);
```

### Proposed Fix

```typescript
const args_str = args.join(" ");
throw new Error(
  `Git command failed:\n` +
    `  Command: git ${args_str}\n` +
    `  CWD: ${this.repoPath}\n` +
    `  Error: ${error.stderr ?? error.message}`,
);
```

### Example - Current (patches.ts:125)

```typescript
throw new Error(`Patch ${patchId} not found`);
```

### Proposed Fix

```typescript
const searchedDirs = ["pending", "applied", "reverted", "failed"]
  .map((s) => getPatchDir(s))
  .join(", ");
throw new Error(`Patch ${patchId} not found\n` + `  Searched directories: ${searchedDirs}`);
```

---

## 3. Missing Retry Logic for Transient Failures (High)

### Problem

Network operations and external commands lack retry mechanisms.

### Affected Operations

- `web-fetch.ts` - HTTP fetches
- `gateway-rebuild-tool.ts` - Gateway health checks
- `dojo-runner.ts` - Docker commands
- `git-tools.ts` - Git operations
- `telemetry-monitor.ts` - Telemetry checks

### Proposed Utility (new file: src/agents/utils/retry.ts)

```typescript
export type RetryOptions = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
};

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  shouldRetry: (err) => {
    const msg = err.message.toLowerCase();
    // Retry on transient errors
    return (
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("rate limit") ||
      msg.includes("429") ||
      msg.includes("503") ||
      msg.includes("502")
    );
  },
};

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

      if (attempt > opts.maxRetries) {
        break;
      }

      if (opts.shouldRetry && !opts.shouldRetry(lastError, attempt)) {
        break;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5),
        opts.maxDelayMs,
      );

      opts.onRetry?.(lastError, attempt, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

### Usage Example - gateway-rebuild-tool.ts

```typescript
// Current (line 143-154)
while (Date.now() - startWait < maxWait && !ready) {
  try {
    await callGateway({ method: "health", params: {}, timeoutMs: 5000 });
    ready = true;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// Proposed
import { withRetry } from "../utils/retry.js";

try {
  await withRetry(() => callGateway({ method: "health", params: {}, timeoutMs: 5000 }), {
    maxRetries: 30,
    baseDelayMs: 2000,
    maxDelayMs: 5000,
    onRetry: (err, attempt) => {
      log.debug(`[rebuild-gateway] Health check attempt ${attempt} failed: ${err.message}`);
    },
  });
  ready = true;
  log.info(`[rebuild-gateway] Gateway is ready`);
} catch (err) {
  log.warn(
    `[rebuild-gateway] Gateway not ready after ${maxWait}ms: ${err instanceof Error ? err.message : String(err)}`,
  );
}
```

---

## 4. Untyped Error Handling (Medium)

### Problem

Error handlers don't distinguish between error types, missing opportunities for specific handling.

### Proposed Error Types (new file: src/agents/errors.ts)

```typescript
export class TransientError extends Error {
  readonly retryable = true;
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "TransientError";
  }
}

export class PermanentError extends Error {
  readonly retryable = false;
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "PermanentError";
  }
}

export class ValidationError extends PermanentError {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends PermanentError {
  constructor(
    public readonly resourceType: string,
    public readonly resourceId: string,
  ) {
    super(`${resourceType} not found: ${resourceId}`);
    this.name = "NotFoundError";
  }
}

export class ExternalServiceError extends Error {
  constructor(
    public readonly service: string,
    message: string,
    public readonly statusCode?: number,
  ) {
    super(`[${service}] ${message}`);
    this.name = "ExternalServiceError";
    this.retryable = statusCode ? statusCode >= 500 || statusCode === 429 : false;
  }
  readonly retryable: boolean;
}

export function isRetryable(error: Error): boolean {
  if ("retryable" in error && typeof error.retryable === "boolean") {
    return error.retryable;
  }
  const msg = error.message.toLowerCase();
  return msg.includes("timeout") || msg.includes("econnreset") || msg.includes("rate limit");
}
```

### Usage Example - patches.ts

```typescript
// Current
throw new Error(`Patch ${patchId} not found`);

// Proposed
throw new NotFoundError("Patch", patchId);
```

---

## 5. Async Operations Missing .catch() (Medium)

### Problem

Fire-and-forget async operations without error handling.

### Example - Current (evolution-daemon.ts:99)

```typescript
this.check().catch((err) => {
  log.error(`[evolution-daemon] Initial check failed: ${err}`);
});
```

This is actually correct! But some places are missing this pattern.

### Pattern to Look For

```typescript
// BAD - unhandled rejection
someAsyncOperation();

// GOOD - with handler
someAsyncOperation().catch((err) => {
  log.error(`Operation failed: ${err instanceof Error ? err.message : String(err)}`);
});

// ALSO GOOD - when we don't care about result
void someAsyncOperation().catch(() => {});
```

---

## 6. Inconsistent Error Logging Format (Low)

### Problem

Error logging uses different formats throughout the codebase.

### Current Patterns Found

```typescript
log.error(`[recovery] Error: ${err}`); // Loses stack
log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`); // Good
log.error("[build-hook] Error in build hook: " + err); // String concat
```

### Proposed Standard

```typescript
// Helper function
function formatError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.message}${err.stack ? `\n${err.stack}` : ""}`;
  }
  return String(err);
}

// Usage
log.error(`[module] Operation failed: ${formatError(err)}`);
```

---

## Priority Implementation Order

### Phase 1 (Critical - Do This Week)

1. Add debug logging to bare catch blocks in:
   - `patches.ts`
   - `meta-learning.ts`
   - `reflexion.ts`

### Phase 2 (High - Next Week)

2. Create `src/agents/utils/retry.ts` with retry utility
3. Add context to error messages in:
   - `git-tools.ts`
   - `mutator.ts`
   - `patches.ts`

### Phase 3 (Medium - Following Week)

4. Create `src/agents/errors.ts` with typed errors
5. Update high-traffic error paths to use typed errors
6. Standardize error logging format

---

## Quick Wins (Can Apply Now)

### 1. Add Log Level to Bare Catches

Find all `} catch {` blocks and add at minimum debug logging:

```bash
# Find all bare catch blocks
grep -rn "} catch {" src/agents/evolution src/agents/tools
```

### 2. Add Operation Context to Throws

When throwing, include:

- What operation was attempted
- What parameters were used
- What the expected state was

### 3. Use Error Cause Chain

```typescript
try {
  await fs.readFile(path);
} catch (err) {
  throw new Error(`Failed to load config from ${path}`, { cause: err });
}
```

---

## Files Requiring Immediate Attention

| File                        | Issues                          | Priority |
| --------------------------- | ------------------------------- | -------- |
| `patches.ts`                | 8 bare catches, missing context | Critical |
| `meta-learning.ts`          | 6 bare catches                  | Critical |
| `build-incremental.ts`      | 10 bare catches                 | High     |
| `session-persistence.ts`    | 8 bare catches                  | High     |
| `reflexion.ts`              | 4 bare catches                  | Medium   |
| `algorithm-distillation.ts` | 4 bare catches                  | Medium   |
| `gateway-rebuild-tool.ts`   | Missing retry logic             | Medium   |
| `git-tools.ts`              | Error messages lack context     | Medium   |
