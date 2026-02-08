import { useCallback, useEffect, useRef } from "react";
import type { CentralClient } from "../client.js";
import type { DashboardAction, SessionSummary } from "../types.js";
import { useInterval } from "./use-interval.js";

type UseGatewayOptions = {
  client: CentralClient;
  dispatch: React.Dispatch<DashboardAction>;
};

/**
 * Manages the gateway connection lifecycle:
 * - Wires onEvent/onConnected/onDisconnected to the store
 * - Periodically polls sessions + agents
 */
export function useGateway({ client, dispatch }: UseGatewayOptions) {
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // Wire callbacks on mount
  useEffect(() => {
    client.onEvent = (evt) => {
      dispatchRef.current({ type: "GATEWAY_EVENT", event: evt });
    };
    client.onConnected = () => {
      dispatchRef.current({ type: "SET_CONNECTED", connected: true });
      if (client.hello) {
        dispatchRef.current({ type: "SET_HELLO", hello: client.hello });
      }
      // Initial data fetch
      void fetchAll();
    };
    client.onDisconnected = () => {
      dispatchRef.current({ type: "SET_CONNECTED", connected: false });
    };

    return () => {
      client.onEvent = undefined;
      client.onConnected = undefined;
      client.onDisconnected = undefined;
    };
  }, [client]);

  const fetchAll = useCallback(async () => {
    try {
      const [agentsResult, sessionsResult, health] = await Promise.all([
        client.listAgents().catch(() => null),
        client.listSessions().catch(() => null),
        client.getHealth().catch(() => null),
      ]);
      if (agentsResult?.agents) {
        dispatchRef.current({ type: "SET_AGENTS", agents: agentsResult.agents });
      }
      if (sessionsResult?.sessions) {
        dispatchRef.current({
          type: "SET_SESSIONS",
          sessions: sessionsResult.sessions as SessionSummary[],
        });
      }
      if (health) {
        dispatchRef.current({ type: "SET_HEALTH", health });
      }
    } catch {
      // Silently ignore — connection may be down
    }
  }, [client]);

  // Poll sessions every 10s
  useInterval(() => {
    void client
      .listSessions()
      .then((res) => {
        if (res?.sessions) {
          dispatchRef.current({
            type: "SET_SESSIONS",
            sessions: res.sessions as SessionSummary[],
          });
        }
      })
      .catch(() => {});
  }, 10_000);

  // Poll agents every 30s
  useInterval(() => {
    void client
      .listAgents()
      .then((res) => {
        if (res?.agents) {
          dispatchRef.current({ type: "SET_AGENTS", agents: res.agents });
        }
      })
      .catch(() => {});
  }, 30_000);

  return { refresh: fetchAll };
}
