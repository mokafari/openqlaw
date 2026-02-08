/**
 * HTTP Client with Connection Pooling
 *
 * Exports the best available HTTP client with connection pooling
 */

export { pooledFetch, pooledHttp, destroyHttpPools, getPoolStats } from "./pooled-client.js";
export {
  undiciPooledFetch,
  undiciHttp,
  destroyUndiciPools,
  isUndiciAvailable,
} from "./undici-client.js";

// Re-export types
export type { PooledFetchOptions, PooledFetchResponse } from "./pooled-client.js";
export type { UndiciClientOptions } from "./undici-client.js";

/**
 * Default HTTP client that chooses the best available implementation
 */
export async function httpClient(
  url: string | URL,
  options: import("./undici-client.js").UndiciClientOptions = {},
): Promise<Response> {
  // Try undici first for better performance, fall back to standard pooled fetch
  const { undiciPooledFetch } = await import("./undici-client.js");
  return undiciPooledFetch(url, options);
}

/**
 * Convenience methods using the best available client
 */
export const http = {
  get: (
    url: string,
    options: Omit<import("./undici-client.js").UndiciClientOptions, "method"> = {},
  ) => httpClient(url, { ...options, method: "GET" }),

  post: (
    url: string,
    options: Omit<import("./undici-client.js").UndiciClientOptions, "method"> = {},
  ) => httpClient(url, { ...options, method: "POST" }),

  put: (
    url: string,
    options: Omit<import("./undici-client.js").UndiciClientOptions, "method"> = {},
  ) => httpClient(url, { ...options, method: "PUT" }),

  delete: (
    url: string,
    options: Omit<import("./undici-client.js").UndiciClientOptions, "method"> = {},
  ) => httpClient(url, { ...options, method: "DELETE" }),

  patch: (
    url: string,
    options: Omit<import("./undici-client.js").UndiciClientOptions, "method"> = {},
  ) => httpClient(url, { ...options, method: "PATCH" }),
};

/**
 * Cleanup all connection pools
 */
export async function destroyAllHttpPools(): Promise<void> {
  const { destroyHttpPools } = await import("./pooled-client.js");
  const { destroyUndiciPools } = await import("./undici-client.js");

  destroyHttpPools();
  await destroyUndiciPools();
}
