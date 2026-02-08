import { randomUUID } from "node:crypto";
import type { CentralClientOptions, HealthSummary, SessionSummary } from "./types.js";
import { GatewayClient } from "../gateway/client.js";
import { GATEWAY_CLIENT_CAPS } from "../gateway/protocol/client-info.js";
import {
  type AgentsListResult,
  type EventFrame,
  type HelloOk,
  PROTOCOL_VERSION,
} from "../gateway/protocol/index.js";
import { resolveGatewayConnection } from "../tui/gateway-chat.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { VERSION } from "../version.js";

export class CentralClient {
  private client: GatewayClient;
  private readyPromise: Promise<void>;
  private resolveReady?: () => void;
  hello?: HelloOk;

  onEvent?: (evt: EventFrame) => void;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;

  constructor(opts: CentralClientOptions) {
    const resolved = resolveGatewayConnection(opts);

    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    this.client = new GatewayClient({
      url: resolved.url,
      token: resolved.token,
      password: resolved.password,
      clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientDisplayName: "openclaw-central",
      clientVersion: VERSION,
      platform: process.platform,
      mode: GATEWAY_CLIENT_MODES.UI,
      caps: [GATEWAY_CLIENT_CAPS.TOOL_EVENTS],
      instanceId: randomUUID(),
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      onHelloOk: (hello) => {
        this.hello = hello;
        this.resolveReady?.();
        this.onConnected?.();
      },
      onEvent: (evt) => {
        this.onEvent?.(evt);
      },
      onClose: (_code, reason) => {
        this.onDisconnected?.(reason);
      },
    });
  }

  start() {
    this.client.start();
  }

  stop() {
    this.client.stop();
  }

  async waitForReady() {
    await this.readyPromise;
  }

  async listAgents(): Promise<AgentsListResult> {
    return await this.client.request<AgentsListResult>("agents.list", {});
  }

  async listSessions(): Promise<{ sessions: SessionSummary[] }> {
    return await this.client.request("sessions.list", {
      limit: 100,
      includeDerivedTitles: true,
      includeLastMessage: true,
    });
  }

  async getHealth(): Promise<HealthSummary> {
    return await this.client.request("health", {});
  }

  async getPresence(): Promise<{ presence: unknown[] }> {
    return await this.client.request("system-presence", {});
  }

  async getChannelsStatus(): Promise<Record<string, unknown>> {
    return await this.client.request("channels.status", {});
  }

  async getChatHistory(sessionKey: string, limit = 50): Promise<Record<string, unknown>> {
    return await this.client.request("chat.history", { sessionKey, limit });
  }
}
