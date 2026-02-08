/**
 * Undici-based HTTP Client with Advanced Connection Pooling
 *
 * Uses undici's Agent for more efficient connection pooling
 * Falls back to standard fetch if undici is not available
 */

import type { Dispatcher } from "undici";

// Lazy import undici to avoid issues if not installed
let undiciAgent: Dispatcher | null = null;
let undiciRequest: typeof import("undici").request | null = null;

async function getUndiciAgent(): Promise<Dispatcher | null> {
  if (undiciAgent !== null) {
    return undiciAgent;
  }

  try {
    const { Agent } = await import("undici");
    undiciAgent = new Agent({
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 600_000,
      keepAlive: true,
      maxRedirections: 10,
      connect: {
        timeout: 10_000,
      },
      bodyTimeout: 300_000,
      headersTimeout: 30_000,
    });
    return undiciAgent;
  } catch {
    // undici not available, will fall back to standard fetch
    undiciAgent = null;
    return null;
  }
}

async function getUndiciRequest(): Promise<typeof import("undici").request | null> {
  if (undiciRequest !== null) {
    return undiciRequest;
  }

  try {
    const { request } = await import("undici");
    undiciRequest = request;
    return undiciRequest;
  } catch {
    undiciRequest = null;
    return null;
  }
}

export interface UndiciClientOptions extends Omit<RequestInit, "signal"> {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Fetch with undici connection pooling if available, otherwise fallback to standard fetch
 */
export async function undiciPooledFetch(
  url: string | URL,
  options: UndiciClientOptions = {},
): Promise<Response> {
  const agent = await getUndiciAgent();
  const request = await getUndiciRequest();

  if (!agent || !request) {
    // Fall back to standard fetch with our pooled client
    const { pooledFetch } = await import("./pooled-client.js");
    return pooledFetch(url, options);
  }

  const urlString = typeof url === "string" ? url : url.toString();

  // Create abort controller for timeout
  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | null = null;

  if (options.timeoutMs) {
    timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
  }

  if (options.signal) {
    const onAbort = () => controller.abort();
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  try {
    const undiciResponse = await request(urlString, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      dispatcher: agent,
    });

    // Convert undici response to fetch-compatible response
    const body = undiciResponse.body;
    const headers = new Headers();

    if (undiciResponse.headers) {
      for (const [key, value] of Object.entries(undiciResponse.headers)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            headers.append(key, v);
          }
        } else if (value !== undefined) {
          headers.set(key, String(value));
        }
      }
    }

    return new Response(body as ReadableStream, {
      status: undiciResponse.statusCode,
      statusText: "",
      headers,
    });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Convenience methods using undici pooling
 */
export const undiciHttp = {
  get: (url: string, options: Omit<UndiciClientOptions, "method"> = {}) =>
    undiciPooledFetch(url, { ...options, method: "GET" }),

  post: (url: string, options: Omit<UndiciClientOptions, "method"> = {}) =>
    undiciPooledFetch(url, { ...options, method: "POST" }),

  put: (url: string, options: Omit<UndiciClientOptions, "method"> = {}) =>
    undiciPooledFetch(url, { ...options, method: "PUT" }),

  delete: (url: string, options: Omit<UndiciClientOptions, "method"> = {}) =>
    undiciPooledFetch(url, { ...options, method: "DELETE" }),

  patch: (url: string, options: Omit<UndiciClientOptions, "method"> = {}) =>
    undiciPooledFetch(url, { ...options, method: "PATCH" }),
};

/**
 * Destroy undici connection pools
 */
export async function destroyUndiciPools(): Promise<void> {
  if (undiciAgent) {
    try {
      await undiciAgent.close();
    } catch {
      // Ignore cleanup errors
    }
    undiciAgent = null;
  }
  undiciRequest = null;
}

/**
 * Check if undici is available and being used
 */
export function isUndiciAvailable(): boolean {
  return undiciAgent !== null;
}
