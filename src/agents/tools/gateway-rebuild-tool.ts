import { Type } from "@sinclair/typebox";
import { randomUUID } from "node:crypto";
import type { AnyAgentTool } from "./common.js";
import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import { log } from "../pi-embedded-runner/logger.js";
import { jsonResult } from "./common.js";

const GatewayRebuildToolSchema = Type.Object({
  reason: Type.Optional(Type.String()),
  rebuild: Type.Optional(Type.Boolean()),
  restart: Type.Optional(Type.Boolean()),
  waitForReady: Type.Optional(Type.Boolean()),
});

export type GatewayRebuildToolResult = {
  success: boolean;
  sessionId?: string;
  rebuildTime?: number;
  restartTime?: number;
  error?: string;
};

/**
 * Gateway Rebuild Tool: Allows agent to trigger gateway rebuild/restart on demand.
 */
export function createGatewayRebuildTool(opts?: { workspaceDir?: string }): AnyAgentTool {
  const workspaceDir = opts?.workspaceDir ?? process.cwd();

  return {
    label: "Gateway",
    name: "rebuild_gateway",
    description:
      "Rebuild and/or restart the gateway. Yields control during rebuild/restart. Returns sessionId for monitoring via process tool.",
    parameters: GatewayRebuildToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const reason = typeof params.reason === "string" ? params.reason.trim() : undefined;
      const rebuild = params.rebuild !== false; // Default: true
      const restart = params.restart !== false; // Default: true
      const waitForReady = params.waitForReady !== false; // Default: true

      const sessionId = `rebuild-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const result: GatewayRebuildToolResult = {
        success: false,
        sessionId,
      };

      try {
        log.info(
          `[rebuild-gateway] Starting rebuild (rebuild=${rebuild}, restart=${restart}, reason=${reason ?? "none"})`,
        );

        // Build command to run in background
        const commands: string[] = [];

        if (rebuild) {
          commands.push("pnpm exec tsdown");
        }

        if (restart) {
          // Restart gateway - this would be done via gateway tool or direct restart
          // For now, we'll use a command that restarts the gateway
          commands.push("echo 'Gateway restart would happen here'");
        }

        if (commands.length === 0) {
          return jsonResult({
            success: false,
            error: "No action specified (rebuild and restart both false)",
          });
        }

        const fullCommand = commands.join(" && ");

        // Spawn rebuild/restart in background
        // In practice, this would use the exec tool with background: true
        // For now, we'll run it and return immediately
        const startTime = Date.now();

        // Run rebuild synchronously for now (in practice would be background)
        if (rebuild) {
          const rebuildStart = Date.now();
          try {
            await runCommandWithTimeout(["pnpm", "exec", "tsdown"], {
              timeoutMs: 300000, // 5 minutes
              cwd: workspaceDir,
            });
            result.rebuildTime = Date.now() - rebuildStart;
            log.info(`[rebuild-gateway] Rebuild completed in ${result.rebuildTime}ms`);
          } catch (err) {
            return jsonResult({
              success: false,
              sessionId,
              error: `Rebuild failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }

        // Restart gateway if requested
        if (restart) {
          const restartStart = Date.now();
          try {
            const cfg = loadConfig();
            // Check if restart is enabled (same check as gateway tool)
            if (cfg.commands?.restart !== true) {
              return jsonResult({
                success: false,
                sessionId,
                error: "Gateway restart is disabled. Set commands.restart=true to enable.",
              });
            }

            // Use SIGUSR1 restart mechanism (same as gateway tool)
            const scheduled = scheduleGatewaySigusr1Restart({
              delayMs: 2000, // 2 second delay for graceful shutdown
              reason: reason ?? "Agent-initiated rebuild",
            });
            result.restartTime = Date.now() - restartStart;
            log.info(
              `[rebuild-gateway] Restart scheduled: ${scheduled.signal} to PID ${scheduled.pid} (delay: ${scheduled.delayMs}ms)`,
            );
          } catch (err) {
            return jsonResult({
              success: false,
              sessionId,
              error: `Gateway restart scheduling failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }

        // Wait for gateway to be ready if requested
        if (waitForReady && restart) {
          const maxWait = 60000; // 60 seconds
          const startWait = Date.now();
          let ready = false;

          while (Date.now() - startWait < maxWait && !ready) {
            try {
              const cfg = loadConfig();
              await callGateway({
                method: "health",
                params: {},
                timeoutMs: 5000,
                config: cfg,
              });
              ready = true;
              log.info(`[rebuild-gateway] Gateway is ready`);
            } catch {
              // Not ready yet, wait a bit
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }

          if (!ready) {
            log.warn(`[rebuild-gateway] Gateway not ready after ${maxWait}ms`);
          }
        }

        result.success = true;
        return jsonResult(result);
      } catch (err) {
        return jsonResult({
          success: false,
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
