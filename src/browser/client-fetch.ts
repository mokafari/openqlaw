import { formatCliCommand } from "../cli/command-format.js";
import {
  createBrowserControlContext,
  startBrowserControlServiceFromConfig,
} from "./control-service.js";
import { createBrowserRouteDispatcher } from "./routes/dispatcher.js";

function isAbsoluteHttp(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function enhanceBrowserFetchError(url: string, err: unknown, timeoutMs: number): Error {
  const hint = isAbsoluteHttp(url)
    ? "If this is a sandboxed session, ensure the sandbox browser is running and try again."
    : `Start (or restart) the OpenClaw gateway (OpenClaw.app menubar, or \`${formatCliCommand("openclaw gateway")}\`) and try again.`;
  const msg = String(err);
  const msgLower = msg.toLowerCase();
  const looksLikeTimeout =
    msgLower.includes("timed out") ||
    msgLower.includes("timeout") ||
    msgLower.includes("aborted") ||
    msgLower.includes("abort") ||
    msgLower.includes("aborterror");
  if (looksLikeTimeout) {
    return new Error(
      `Can't reach the OpenClaw browser control service (timed out after ${timeoutMs}ms). ${hint}`,
    );
  }
  return new Error(`Can't reach the OpenClaw browser control service. ${hint} (${msg})`);
}

/**
 * Determine whether an error is transient and worth retrying.
 * Covers timeouts, connection resets, DNS hiccups, and CDP reconnection races.
 */
function isTransientError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("abort") ||
    msg.includes("aborterror") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("socket hang up") ||
    msg.includes("epipe")
  );
}

/** Maximum number of retry attempts for transient browser fetch failures. */
const BROWSER_FETCH_MAX_RETRIES = 3;

/** Base delay in ms between retries (doubled on each subsequent attempt). */
const BROWSER_FETCH_RETRY_BASE_DELAY_MS = 250;

async function fetchHttpJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = init.timeoutMs ?? 5000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchBrowserJson<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 5000;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= BROWSER_FETCH_MAX_RETRIES; attempt++) {
    try {
      if (isAbsoluteHttp(url)) {
        return await fetchHttpJson<T>(url, { ...init, timeoutMs });
      }
      const started = await startBrowserControlServiceFromConfig();
      if (!started) {
        throw new Error("browser control disabled");
      }
      const dispatcher = createBrowserRouteDispatcher(createBrowserControlContext());
      const parsed = new URL(url, "http://localhost");
      const query: Record<string, unknown> = {};
      for (const [key, value] of parsed.searchParams.entries()) {
        query[key] = value;
      }
      let body = init?.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          // keep as string
        }
      }
      const dispatchPromise = dispatcher.dispatch({
        method:
          init?.method?.toUpperCase() === "DELETE"
            ? "DELETE"
            : init?.method?.toUpperCase() === "POST"
              ? "POST"
              : "GET",
        path: parsed.pathname,
        query,
        body,
      });

      const result = await (timeoutMs
        ? Promise.race([
            dispatchPromise,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("timed out")), timeoutMs),
            ),
          ])
        : dispatchPromise);

      if (result.status >= 400) {
        const message =
          result.body && typeof result.body === "object" && "error" in result.body
            ? String((result.body as { error?: unknown }).error)
            : `HTTP ${result.status}`;
        throw new Error(message);
      }
      return result.body as T;
    } catch (err) {
      lastErr = err;
      // Only retry on transient errors; bail immediately on logical/config errors
      if (attempt < BROWSER_FETCH_MAX_RETRIES && isTransientError(err)) {
        const delay = BROWSER_FETCH_RETRY_BASE_DELAY_MS * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }

  throw enhanceBrowserFetchError(url, lastErr, timeoutMs);
}
