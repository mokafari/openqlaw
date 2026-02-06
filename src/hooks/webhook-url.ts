/**
 * Webhook URL Builder
 *
 * Utility functions for constructing webhook URLs with the correct gateway port.
 * Used by sub-agents and skills to send webhook notifications.
 */

import type { OpenClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { resolveGatewayPort, DEFAULT_GATEWAY_PORT } from "../config/paths.js";

/**
 * Build a webhook URL for the given path
 *
 * @param path - Webhook path (e.g., "djs3/phase7-done" or "wake")
 * @param config - Optional config (defaults to loaded config)
 * @returns Full webhook URL (e.g., "http://127.0.0.1:18789/hooks/djs3/phase7-done")
 */
export function buildWebhookUrl(path: string, config?: OpenClawConfig): string {
  const cfg = config ?? loadConfig();
  const port = resolveGatewayPort(cfg);
  const hooksPath = cfg.hooks?.path?.trim() || "/hooks";
  const normalizedPath = hooksPath.replace(/\/+$/, ""); // Remove trailing slashes
  const normalizedSubPath = path.replace(/^\/+/, ""); // Remove leading slashes
  return `http://127.0.0.1:${port}${normalizedPath}/${normalizedSubPath}`;
}

/**
 * Build a webhook URL with authentication token for curl commands
 *
 * @param path - Webhook path (e.g., "djs3/phase7-done")
 * @param config - Optional config (defaults to loaded config)
 * @returns Object with URL and curl command template
 */
export function buildWebhookCurlCommand(
  path: string,
  config?: OpenClawConfig,
): { url: string; curlCommand: string } {
  const cfg = config ?? loadConfig();
  const url = buildWebhookUrl(path, cfg);
  const token = cfg.hooks?.token?.trim();

  if (!token) {
    throw new Error(
      "hooks.token is required. Enable hooks in config: { hooks: { enabled: true, token: 'your-secret' } }",
    );
  }

  const curlCommand = `curl -X POST ${url} -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' -d '{"text":"Task complete"}'`;

  return { url, curlCommand };
}

/**
 * Get the gateway port (for use in agent prompts/templates)
 *
 * @param config - Optional config (defaults to loaded config)
 * @returns Gateway port number
 */
export function getGatewayPort(config?: OpenClawConfig): number {
  const cfg = config ?? loadConfig();
  return resolveGatewayPort(cfg);
}
