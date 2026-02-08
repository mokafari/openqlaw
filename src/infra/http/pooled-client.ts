/**
 * HTTP Client with Connection Pooling
 *
 * Provides a centralized HTTP client that reuses connections to reduce
 * connection overhead for frequent API calls (OpenAI, Gemini, Feishu, etc.)
 */

import { Agent as HttpAgent } from "http";
import { Agent as HttpsAgent } from "https";

export interface PooledFetchOptions extends RequestInit {
  timeoutMs?: number;
}

export interface PooledFetchResponse extends Response {
  // Add any custom properties if needed
}

// Global HTTP agents with connection pooling
const httpAgent = new HttpAgent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60_000, // Socket timeout
});

const httpsAgent = new HttpsAgent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60_000, // Socket timeout
});

/**
 * Get the appropriate HTTP agent for a URL
 */
function getHttpAgent(url: string): HttpAgent | HttpsAgent {
  return url.startsWith("https") ? httpsAgent : httpAgent;
}

/**
 * Create abort signal with timeout
 */
function createTimeoutSignal(
  timeoutMs?: number,
  existingSignal?: AbortSignal,
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  if (!timeoutMs && !existingSignal) {
    const controller = new AbortController();
    return { signal: controller.signal, cleanup: () => {} };
  }

  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | null = null;

  if (timeoutMs) {
    timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  const onAbort = () => controller.abort();
  if (existingSignal) {
    if (existingSignal.aborted) {
      controller.abort();
    } else {
      existingSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (existingSignal) {
      existingSignal.removeEventListener("abort", onAbort);
    }
  };

  return { signal: controller.signal, cleanup };
}

/**
 * Fetch with connection pooling and enhanced timeout support
 */
export async function pooledFetch(
  input: RequestInfo | URL,
  options: PooledFetchOptions = {},
): Promise<PooledFetchResponse> {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  // Create timeout signal
  const { signal, cleanup } = createTimeoutSignal(options.timeoutMs, options.signal);

  try {
    // For Node.js fetch, we need to use the agent option if available
    const fetchOptions: RequestInit = {
      ...options,
      signal,
    };

    // Node 18+ fetch supports agent option in some environments
    // This will work if undici is being used as the fetch implementation
    if (typeof (fetchOptions as any).agent === "undefined") {
      try {
        (fetchOptions as any).agent = getHttpAgent(url);
      } catch {
        // If agent option is not supported, continue without it
        // The global fetch might have its own connection pooling
      }
    }

    const response = await fetch(input, fetchOptions);
    return response as PooledFetchResponse;
  } finally {
    cleanup();
  }
}

/**
 * Convenience methods for common HTTP verbs
 */
export const pooledHttp = {
  /**
   * GET request with connection pooling
   */
  get: (url: string, options: Omit<PooledFetchOptions, "method"> = {}) =>
    pooledFetch(url, { ...options, method: "GET" }),

  /**
   * POST request with connection pooling
   */
  post: (url: string, options: Omit<PooledFetchOptions, "method"> = {}) =>
    pooledFetch(url, { ...options, method: "POST" }),

  /**
   * PUT request with connection pooling
   */
  put: (url: string, options: Omit<PooledFetchOptions, "method"> = {}) =>
    pooledFetch(url, { ...options, method: "PUT" }),

  /**
   * DELETE request with connection pooling
   */
  delete: (url: string, options: Omit<PooledFetchOptions, "method"> = {}) =>
    pooledFetch(url, { ...options, method: "DELETE" }),

  /**
   * PATCH request with connection pooling
   */
  patch: (url: string, options: Omit<PooledFetchOptions, "method"> = {}) =>
    pooledFetch(url, { ...options, method: "PATCH" }),
};

/**
 * Cleanup function to destroy connection pools
 * Should be called when shutting down the application
 */
export function destroyHttpPools(): void {
  httpAgent.destroy();
  httpsAgent.destroy();
}

/**
 * Get pool statistics for monitoring
 */
export function getPoolStats() {
  return {
    http: {
      maxSockets: httpAgent.maxSockets,
      maxFreeSockets: httpAgent.maxFreeSockets,
      // Note: These properties may not be available in all Node.js versions
      sockets: Object.keys((httpAgent as any).sockets || {}).length,
      freeSockets: Object.keys((httpAgent as any).freeSockets || {}).length,
    },
    https: {
      maxSockets: httpsAgent.maxSockets,
      maxFreeSockets: httpsAgent.maxFreeSockets,
      sockets: Object.keys((httpsAgent as any).sockets || {}).length,
      freeSockets: Object.keys((httpsAgent as any).freeSockets || {}).length,
    },
  };
}
