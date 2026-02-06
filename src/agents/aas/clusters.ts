/**
 * Tool Clusters - Group tools by operational context
 *
 * Reduces token usage by loading only relevant tool definitions
 * based on the agent's current operational mode.
 */

import type { SessionEntry } from "../../config/sessions/types.js";
import type { ClusterId, ToolCluster } from "./types.js";

export const TOOL_CLUSTERS: Record<ClusterId, ToolCluster> = {
  coding: {
    id: "coding",
    name: "Coding",
    tools: ["read", "write", "edit", "apply_patch", "exec", "grep", "find", "ls"],
    defaultContextArea: "filesystem",
  },
  messaging: {
    id: "messaging",
    name: "Messaging",
    tools: ["message", "sessions_send", "sessions_spawn", "tts"],
    defaultContextArea: "messaging",
  },
  web: {
    id: "web",
    name: "Web",
    tools: ["browser", "web_search", "web_fetch"],
    defaultContextArea: "web",
  },
  scheduling: {
    id: "scheduling",
    name: "Scheduling",
    tools: ["cron", "nodes"],
    defaultContextArea: "scheduling",
  },
  system: {
    id: "system",
    name: "System",
    tools: ["gateway", "agents_list", "session_status", "sessions_list", "sessions_history"],
    defaultContextArea: "system",
  },
  filesystem: {
    id: "filesystem",
    name: "File System",
    tools: ["read", "write", "edit", "apply_patch", "grep", "find", "ls", "image"],
    defaultContextArea: "filesystem",
  },
  browser: {
    id: "browser",
    name: "Browser",
    tools: ["browser"],
    defaultContextArea: "browser",
  },
};

export function getCluster(clusterId: ClusterId): ToolCluster | undefined {
  return TOOL_CLUSTERS[clusterId];
}

export function getClusterForTool(toolName: string): ClusterId | undefined {
  for (const [id, cluster] of Object.entries(TOOL_CLUSTERS)) {
    if (cluster.tools.includes(toolName)) {
      return id as ClusterId;
    }
  }
  return undefined;
}

export function getClustersForTools(toolNames: string[]): ClusterId[] {
  const clusters = new Set<ClusterId>();
  for (const toolName of toolNames) {
    const cluster = getClusterForTool(toolName);
    if (cluster) {
      clusters.add(cluster);
    }
  }
  return Array.from(clusters);
}

export function getAllToolsInCluster(clusterId: ClusterId): string[] {
  const cluster = getCluster(clusterId);
  return cluster?.tools ?? [];
}

export function resolveActiveClusters(sessionState?: SessionEntry): ClusterId[] {
  // Default: return all clusters if no state
  if (!sessionState) {
    return Object.keys(TOOL_CLUSTERS) as ClusterId[];
  }

  // For now, return all clusters
  // In the future, this could be based on session state, current task, etc.
  return Object.keys(TOOL_CLUSTERS) as ClusterId[];
}

export function getToolsForClusters(clusterIds: ClusterId[]): string[] {
  const tools = new Set<string>();
  for (const clusterId of clusterIds) {
    const cluster = getCluster(clusterId);
    if (cluster) {
      for (const tool of cluster.tools) {
        tools.add(tool);
      }
    }
  }
  return Array.from(tools);
}

export function filterToolsByCluster(toolNames: string[], activeClusters: ClusterId[]): string[] {
  const clusterTools = getToolsForClusters(activeClusters);
  return toolNames.filter((name) => clusterTools.includes(name));
}

export function transitionCluster(from: ClusterId, to: ClusterId): string {
  const fromCluster = getCluster(from);
  const toCluster = getCluster(to);

  if (!fromCluster || !toCluster) {
    return `Invalid cluster transition: ${from} -> ${to}`;
  }

  // Find common tools or entry points
  const commonTools = fromCluster.tools.filter((t) => toCluster.tools.includes(t));
  if (commonTools.length > 0) {
    return `Transition via shared tool: ${commonTools[0]}`;
  }

  // Check if there's a reachability path
  if (fromCluster.defaultContextArea && toCluster.defaultContextArea) {
    return `Transition from ${fromCluster.name} to ${toCluster.name} context`;
  }

  return `Portal: ${fromCluster.name} -> ${toCluster.name}`;
}
