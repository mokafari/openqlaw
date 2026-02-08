/**
 * DyTopo: Dynamic Topology Routing for Multi-Agent Reasoning
 *
 * Implements the DyTopo pattern (Lu et al., Feb 2026) for adaptive
 * multi-agent communication via semantic matching.
 *
 * Key concepts:
 * - Query (need) and Key (offer) descriptors per agent
 * - Semantic matching to induce directed communication graph
 * - Sparse routing: messages only flow along activated edges
 * - Topology adapts each round based on evolving agent states
 *
 * Research basis:
 * - "DyTopo: Dynamic Topology Routing for Multi-Agent Reasoning via Semantic Matching"
 * - arXiv:2602.06039 (February 2026)
 * - +6.2% avg improvement over strongest baselines
 */

import { log } from "../pi-embedded-runner/logger.js";

export interface AgentDescriptor {
  agentId: string;
  role: string;
  query: string; // What this agent needs (information-seeking)
  key: string; // What this agent can offer (capability)
  publicMessage?: string; // Visible to manager
  privateMessage?: string; // Routed to matching agents
}

export interface TopologyEdge {
  from: string; // Provider agent ID
  to: string; // Consumer agent ID
  similarity: number; // Cosine similarity score
  round: number;
}

export interface CommunicationGraph {
  round: number;
  timestamp: string;
  roundGoal: string;
  agents: string[];
  edges: TopologyEdge[];
  adjacency: Map<string, string[]>; // agentId -> incoming neighbors
}

export interface DyTopoConfig {
  /** Similarity threshold for edge activation (default: 0.5) */
  edgeThreshold: number;
  /** Maximum edges per agent (prevents overload) */
  maxEdgesPerAgent: number;
  /** Use local embeddings vs simple keyword matching */
  useEmbeddings: boolean;
  /** Log topology changes */
  logTopology: boolean;
}

const DEFAULT_CONFIG: DyTopoConfig = {
  edgeThreshold: 0.5,
  maxEdgesPerAgent: 3,
  useEmbeddings: false, // Start with keyword matching, upgrade to embeddings later
  logTopology: true,
};

/**
 * Simple keyword-based similarity (fallback when embeddings unavailable)
 */
function keywordSimilarity(query: string, key: string): number {
  const queryWords = new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
  const keyWords = new Set(
    key
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );

  if (queryWords.size === 0 || keyWords.size === 0) return 0;

  let matches = 0;
  for (const word of queryWords) {
    if (keyWords.has(word)) matches++;
  }

  // Jaccard-like similarity
  return matches / Math.sqrt(queryWords.size * keyWords.size);
}

/**
 * DyTopo Router - manages dynamic multi-agent topology
 */
export class DyTopoRouter {
  private config: DyTopoConfig;
  private roundHistory: CommunicationGraph[] = [];
  private embedCache: Map<string, number[]> = new Map();

  constructor(config: Partial<DyTopoConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate descriptor prompt for an agent
   * Agents should include this in their output
   */
  generateDescriptorPrompt(roundGoal: string): string {
    return `
## Communication Topology (DyTopo)

Current round goal: ${roundGoal}

Please provide brief descriptors for routing:

**NEED:** [What information or capability do you currently need from other agents? 1-2 sentences]

**OFFER:** [What information or capability can you provide to other agents? 1-2 sentences]

**PUBLIC:** [Brief status update for the manager]

**PRIVATE:** [Detailed information to share with matching agents]
`;
  }

  /**
   * Parse agent output to extract descriptors
   */
  parseDescriptors(agentId: string, role: string, output: string): AgentDescriptor {
    const needMatch = output.match(/\*\*NEED:\*\*\s*(.+?)(?=\*\*|$)/is);
    const offerMatch = output.match(/\*\*OFFER:\*\*\s*(.+?)(?=\*\*|$)/is);
    const publicMatch = output.match(/\*\*PUBLIC:\*\*\s*(.+?)(?=\*\*|$)/is);
    const privateMatch = output.match(/\*\*PRIVATE:\*\*\s*(.+?)(?=\*\*|$)/is);

    return {
      agentId,
      role,
      query: needMatch?.[1]?.trim() || `Need guidance on ${role} tasks`,
      key: offerMatch?.[1]?.trim() || `Can provide ${role} expertise`,
      publicMessage: publicMatch?.[1]?.trim(),
      privateMessage: privateMatch?.[1]?.trim(),
    };
  }

  /**
   * Compute semantic similarity between query and key
   */
  private computeSimilarity(query: string, key: string): number {
    if (this.config.useEmbeddings) {
      // TODO: Integrate with embedding model
      // For now, fall back to keyword matching
      return keywordSimilarity(query, key);
    } else {
      return keywordSimilarity(query, key);
    }
  }

  /**
   * Induce communication graph for current round
   * Core DyTopo algorithm
   */
  induceTopology(
    round: number,
    roundGoal: string,
    descriptors: AgentDescriptor[],
  ): CommunicationGraph {
    const agents = descriptors.map((d) => d.agentId);
    const edges: TopologyEdge[] = [];
    const adjacency = new Map<string, string[]>();

    // Initialize adjacency lists
    for (const agent of agents) {
      adjacency.set(agent, []);
    }

    // Compute pairwise similarities and create edges
    for (const consumer of descriptors) {
      const candidateEdges: TopologyEdge[] = [];

      for (const provider of descriptors) {
        // No self-loops
        if (consumer.agentId === provider.agentId) continue;

        const similarity = this.computeSimilarity(consumer.query, provider.key);

        if (similarity > this.config.edgeThreshold) {
          candidateEdges.push({
            from: provider.agentId,
            to: consumer.agentId,
            similarity,
            round,
          });
        }
      }

      // Sort by similarity and take top K
      candidateEdges.sort((a, b) => b.similarity - a.similarity);
      const topEdges = candidateEdges.slice(0, this.config.maxEdgesPerAgent);

      for (const edge of topEdges) {
        edges.push(edge);
        adjacency.get(edge.to)!.push(edge.from);
      }
    }

    const graph: CommunicationGraph = {
      round,
      timestamp: new Date().toISOString(),
      roundGoal,
      agents,
      edges,
      adjacency,
    };

    this.roundHistory.push(graph);

    if (this.config.logTopology) {
      log.info(
        `[DyTopo] Round ${round}: ${edges.length} edges induced for ${agents.length} agents`,
      );
    }

    return graph;
  }

  /**
   * Route private messages according to induced topology
   */
  routeMessages(graph: CommunicationGraph, descriptors: AgentDescriptor[]): Map<string, string[]> {
    const routed = new Map<string, string[]>();

    // Initialize empty message lists
    for (const agent of graph.agents) {
      routed.set(agent, []);
    }

    // Route messages along edges
    for (const edge of graph.edges) {
      const provider = descriptors.find((d) => d.agentId === edge.from);
      if (provider?.privateMessage) {
        routed.get(edge.to)!.push(`[From ${provider.role}]: ${provider.privateMessage}`);
      }
    }

    return routed;
  }

  /**
   * Get incoming messages for an agent after routing
   */
  getIncomingMessages(agentId: string, routed: Map<string, string[]>): string[] {
    return routed.get(agentId) || [];
  }

  /**
   * Generate context update for next round
   * Includes round goal and routed messages
   */
  generateRoundContext(agentId: string, nextRoundGoal: string, incomingMessages: string[]): string {
    let context = `## Round Update\n\n**Goal:** ${nextRoundGoal}\n\n`;

    if (incomingMessages.length > 0) {
      context += `**Messages from collaborating agents:**\n`;
      for (const msg of incomingMessages) {
        context += `- ${msg}\n`;
      }
      context += "\n";
    } else {
      context += "*No incoming messages this round.*\n\n";
    }

    return context;
  }

  /**
   * Get topology evolution trace for analysis
   */
  getTopologyTrace(): {
    rounds: number;
    totalEdges: number;
    avgEdgesPerRound: number;
    densityOverTime: number[];
  } {
    const densityOverTime = this.roundHistory.map((g) => {
      const maxEdges = g.agents.length * (g.agents.length - 1);
      return maxEdges > 0 ? g.edges.length / maxEdges : 0;
    });

    const totalEdges = this.roundHistory.reduce((sum, g) => sum + g.edges.length, 0);

    return {
      rounds: this.roundHistory.length,
      totalEdges,
      avgEdgesPerRound: this.roundHistory.length > 0 ? totalEdges / this.roundHistory.length : 0,
      densityOverTime,
    };
  }

  /**
   * Visualize current topology as ASCII graph
   */
  visualizeTopology(graph: CommunicationGraph): string {
    const lines: string[] = [];
    lines.push(`Round ${graph.round} Topology (${graph.edges.length} edges)`);
    lines.push(`Goal: ${graph.roundGoal.slice(0, 50)}...`);
    lines.push("─".repeat(40));

    for (const edge of graph.edges) {
      const arrow = edge.similarity > 0.7 ? "═══>" : edge.similarity > 0.5 ? "───>" : "···>";
      lines.push(`  ${edge.from} ${arrow} ${edge.to} (${(edge.similarity * 100).toFixed(0)}%)`);
    }

    if (graph.edges.length === 0) {
      lines.push("  (no edges - agents working independently)");
    }

    return lines.join("\n");
  }

  /**
   * Reset router state for new task
   */
  reset(): void {
    this.roundHistory = [];
    this.embedCache.clear();
  }
}

/**
 * Factory function for creating DyTopo router
 */
export function createDyTopoRouter(config?: Partial<DyTopoConfig>): DyTopoRouter {
  return new DyTopoRouter(config);
}
