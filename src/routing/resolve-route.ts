import type { OpenClawConfig } from "../config/config.js";
import type { AgentBinding } from "../config/types.agents.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { listBindings } from "./bindings.js";
import {
  buildAgentMainSessionKey,
  buildAgentPeerSessionKey,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_MAIN_KEY,
  normalizeAgentId,
  sanitizeAgentId,
} from "./session-key.js";

export type RoutePeerKind = "dm" | "group" | "channel";

export type RoutePeer = {
  kind: RoutePeerKind;
  id: string;
};

export type ResolveAgentRouteInput = {
  cfg: OpenClawConfig;
  channel: string;
  accountId?: string | null;
  peer?: RoutePeer | null;
  /** Parent peer for threads — used for binding inheritance when peer doesn't match directly. */
  parentPeer?: RoutePeer | null;
  guildId?: string | null;
  teamId?: string | null;
};

export type ResolvedAgentRoute = {
  agentId: string;
  channel: string;
  accountId: string;
  /** Internal session key used for persistence + concurrency. */
  sessionKey: string;
  /** Convenience alias for direct-chat collapse. */
  mainSessionKey: string;
  /** Match description for debugging/logging. */
  matchedBy:
    | "binding.peer"
    | "binding.peer.parent"
    | "binding.guild"
    | "binding.team"
    | "binding.account"
    | "binding.channel"
    | "default";
};

export { DEFAULT_ACCOUNT_ID, DEFAULT_AGENT_ID } from "./session-key.js";

// Route resolution cache
const routeCache = new Map<string, { route: ResolvedAgentRoute; expires: number }>();
const CACHE_TTL_MS = 5_000;

function getCachedRoute(key: string): ResolvedAgentRoute | null {
  const cached = routeCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.route;
  }
  routeCache.delete(key); // Clean expired
  return null;
}

export function clearRouteCache(): void {
  routeCache.clear();
  clearBindingIndex();
}

// Indexed Binding Lookup for O(1) performance
type BindingIndex = {
  byPeer: Map<string, AgentBinding[]>; // key: "channel:account:kind:id"
  byGuild: Map<string, AgentBinding[]>; // key: "channel:account:guildId"
  byTeam: Map<string, AgentBinding[]>; // key: "channel:account:teamId"
  byAccount: Map<string, AgentBinding[]>; // key: "channel:account"
  byChannel: Map<string, AgentBinding[]>; // key: "channel:*"
};

let bindingIndex: BindingIndex | null = null;
let bindingIndexCfgHash: string | null = null;

function getBindingIndex(cfg: OpenClawConfig): BindingIndex {
  const cfgHash = JSON.stringify(cfg.bindings || []);
  if (bindingIndex && bindingIndexCfgHash === cfgHash) {
    return bindingIndex;
  }

  bindingIndex = buildBindingIndex(cfg);
  bindingIndexCfgHash = cfgHash;
  return bindingIndex;
}

function buildBindingIndex(cfg: OpenClawConfig): BindingIndex {
  const bindings = listBindings(cfg);
  const index: BindingIndex = {
    byPeer: new Map(),
    byGuild: new Map(),
    byTeam: new Map(),
    byAccount: new Map(),
    byChannel: new Map(),
  };

  for (const binding of bindings) {
    if (!binding || typeof binding !== "object") {
      continue;
    }

    const channel = normalizeToken(binding.match?.channel) || "";
    const accountId = binding.match?.accountId || "*";

    // Index by specificity level
    if (binding.match?.peer) {
      const key = `${channel}:${accountId}:${binding.match.peer.kind}:${binding.match.peer.id}`;
      addToIndex(index.byPeer, key, binding);
    }

    if (binding.match?.guildId) {
      const key = `${channel}:${accountId}:${binding.match.guildId}`;
      addToIndex(index.byGuild, key, binding);
    }

    if (binding.match?.teamId) {
      const key = `${channel}:${accountId}:${binding.match.teamId}`;
      addToIndex(index.byTeam, key, binding);
    }

    // Index account-specific bindings (no peer/guild/team)
    if (!binding.match?.peer && !binding.match?.guildId && !binding.match?.teamId) {
      if (accountId !== "*") {
        const key = `${channel}:${accountId}`;
        addToIndex(index.byAccount, key, binding);
      } else {
        // Wildcard account bindings
        const key = `${channel}:*`;
        addToIndex(index.byChannel, key, binding);
      }
    }
  }

  return index;
}

function addToIndex(map: Map<string, AgentBinding[]>, key: string, binding: AgentBinding): void {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key)!.push(binding);
}

// Clear binding index when route cache is cleared
export function clearBindingIndex(): void {
  bindingIndex = null;
  bindingIndexCfgHash = null;
}

function normalizeToken(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeId(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function normalizeAccountId(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : DEFAULT_ACCOUNT_ID;
}

// Note: matchesAccountId function removed - now using indexed lookup for O(1) performance

export function buildAgentSessionKey(params: {
  agentId: string;
  channel: string;
  accountId?: string | null;
  peer?: RoutePeer | null;
  /** DM session scope. */
  dmScope?: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
  identityLinks?: Record<string, string[]>;
}): string {
  const channel = normalizeToken(params.channel) || "unknown";
  const peer = params.peer;
  return buildAgentPeerSessionKey({
    agentId: params.agentId,
    mainKey: DEFAULT_MAIN_KEY,
    channel,
    accountId: params.accountId,
    peerKind: peer?.kind ?? "dm",
    peerId: peer ? normalizeId(peer.id) || "unknown" : null,
    dmScope: params.dmScope,
    identityLinks: params.identityLinks,
  });
}

function listAgents(cfg: OpenClawConfig) {
  const agents = cfg.agents?.list;
  return Array.isArray(agents) ? agents : [];
}

function pickFirstExistingAgentId(cfg: OpenClawConfig, agentId: string): string {
  const trimmed = (agentId ?? "").trim();
  if (!trimmed) {
    return sanitizeAgentId(resolveDefaultAgentId(cfg));
  }
  const normalized = normalizeAgentId(trimmed);
  const agents = listAgents(cfg);
  if (agents.length === 0) {
    return sanitizeAgentId(trimmed);
  }
  const match = agents.find((agent) => normalizeAgentId(agent.id) === normalized);
  if (match?.id?.trim()) {
    return sanitizeAgentId(match.id.trim());
  }
  return sanitizeAgentId(resolveDefaultAgentId(cfg));
}

// Note: Legacy matching functions removed - now using indexed lookup for O(1) performance

export function resolveAgentRoute(input: ResolveAgentRouteInput): ResolvedAgentRoute {
  const channel = normalizeToken(input.channel);
  const accountId = normalizeAccountId(input.accountId);
  const peer = input.peer ? { kind: input.peer.kind, id: normalizeId(input.peer.id) } : null;
  const guildId = normalizeId(input.guildId);
  const teamId = normalizeId(input.teamId);

  // Check cache first
  const cacheKey = `${channel}:${accountId}:${peer?.kind || "null"}:${peer?.id || "null"}`;
  const cached = getCachedRoute(cacheKey);
  if (cached) return cached;

  // Get indexed bindings for O(1) lookup
  const index = getBindingIndex(input.cfg);

  const dmScope = input.cfg.session?.dmScope ?? "main";
  const identityLinks = input.cfg.session?.identityLinks;

  const choose = (agentId: string, matchedBy: ResolvedAgentRoute["matchedBy"]) => {
    const resolvedAgentId = pickFirstExistingAgentId(input.cfg, agentId);
    const sessionKey = buildAgentSessionKey({
      agentId: resolvedAgentId,
      channel,
      accountId,
      peer,
      dmScope,
      identityLinks,
    }).toLowerCase();
    const mainSessionKey = buildAgentMainSessionKey({
      agentId: resolvedAgentId,
      mainKey: DEFAULT_MAIN_KEY,
    }).toLowerCase();
    return {
      agentId: resolvedAgentId,
      channel,
      accountId,
      sessionKey,
      mainSessionKey,
      matchedBy,
    };
  };

  // 1. Check peer binding (highest priority)
  if (peer) {
    const peerKey = `${channel}:${accountId}:${peer.kind}:${peer.id}`;
    const peerBindings = index.byPeer.get(peerKey);
    if (peerBindings && peerBindings.length > 0) {
      const result = choose(peerBindings[0].agentId, "binding.peer");
      routeCache.set(cacheKey, { route: result, expires: Date.now() + CACHE_TTL_MS });
      return result;
    }
  }

  // 2. Thread parent inheritance: if peer (thread) didn't match, check parent peer binding
  const parentPeer = input.parentPeer
    ? { kind: input.parentPeer.kind, id: normalizeId(input.parentPeer.id) }
    : null;
  if (parentPeer && parentPeer.id) {
    const parentPeerKey = `${channel}:${accountId}:${parentPeer.kind}:${parentPeer.id}`;
    const parentPeerBindings = index.byPeer.get(parentPeerKey);
    if (parentPeerBindings && parentPeerBindings.length > 0) {
      const result = choose(parentPeerBindings[0].agentId, "binding.peer.parent");
      routeCache.set(cacheKey, { route: result, expires: Date.now() + CACHE_TTL_MS });
      return result;
    }
  }

  // 3. Check guild binding
  if (guildId) {
    const guildKey = `${channel}:${accountId}:${guildId}`;
    const guildBindings = index.byGuild.get(guildKey);
    if (guildBindings && guildBindings.length > 0) {
      const result = choose(guildBindings[0].agentId, "binding.guild");
      routeCache.set(cacheKey, { route: result, expires: Date.now() + CACHE_TTL_MS });
      return result;
    }
  }

  // 4. Check team binding
  if (teamId) {
    const teamKey = `${channel}:${accountId}:${teamId}`;
    const teamBindings = index.byTeam.get(teamKey);
    if (teamBindings && teamBindings.length > 0) {
      const result = choose(teamBindings[0].agentId, "binding.team");
      routeCache.set(cacheKey, { route: result, expires: Date.now() + CACHE_TTL_MS });
      return result;
    }
  }

  // 5. Check account-specific binding
  const accountKey = `${channel}:${accountId}`;
  const accountBindings = index.byAccount.get(accountKey);
  if (accountBindings && accountBindings.length > 0) {
    const result = choose(accountBindings[0].agentId, "binding.account");
    routeCache.set(cacheKey, { route: result, expires: Date.now() + CACHE_TTL_MS });
    return result;
  }

  // 6. Check channel wildcard binding
  const channelKey = `${channel}:*`;
  const channelBindings = index.byChannel.get(channelKey);
  if (channelBindings && channelBindings.length > 0) {
    const result = choose(channelBindings[0].agentId, "binding.channel");
    routeCache.set(cacheKey, { route: result, expires: Date.now() + CACHE_TTL_MS });
    return result;
  }

  // 7. Default agent

  const result = choose(resolveDefaultAgentId(input.cfg), "default");
  routeCache.set(cacheKey, { route: result, expires: Date.now() + CACHE_TTL_MS });
  return result;
}
