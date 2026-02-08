/**
 * DyTopo Integration for sessions_spawn
 *
 * Provides semantic agent selection using DyTopo routing patterns.
 * When spawning subagents, this module helps select the best agent
 * based on task-agent semantic matching.
 */

import { log } from "../pi-embedded-runner/logger.js";
import { createDyTopoRouter, AgentDescriptor, DyTopoConfig } from "./dytopo-routing.js";

export interface AgentProfile {
  agentId: string;
  name: string;
  description: string;
  capabilities: string[];
  strengths: string[];
  bestFor: string[];
}

// Registry of available agents with their profiles
const AGENT_REGISTRY: AgentProfile[] = [
  {
    agentId: "default",
    name: "Default Agent",
    description: "General-purpose agent for most tasks",
    capabilities: ["code", "research", "communication", "file-ops"],
    strengths: ["versatility", "broad knowledge"],
    bestFor: ["general tasks", "mixed workloads"],
  },
  {
    agentId: "coder",
    name: "Coding Agent",
    description: "Specialized for code generation, debugging, and refactoring",
    capabilities: ["code-generation", "debugging", "refactoring", "testing"],
    strengths: ["TypeScript", "system design", "algorithms"],
    bestFor: ["implementation", "bug fixes", "code review"],
  },
  {
    agentId: "researcher",
    name: "Research Agent",
    description: "Specialized for information gathering and analysis",
    capabilities: ["web-search", "paper-analysis", "summarization"],
    strengths: ["synthesis", "deep research", "citation tracking"],
    bestFor: ["research tasks", "competitive analysis", "learning"],
  },
  {
    agentId: "planner",
    name: "Planning Agent",
    description: "Specialized for strategic planning and decomposition",
    capabilities: ["goal-decomposition", "dependency-analysis", "scheduling"],
    strengths: ["long-term planning", "risk assessment"],
    bestFor: ["complex projects", "multi-step tasks", "architecture"],
  },
];

/**
 * Convert task description to agent query descriptor
 */
function taskToQuery(task: string): string {
  // Extract key requirements from task
  const keywords: string[] = [];

  const taskLower = task.toLowerCase();

  if (taskLower.includes("implement") || taskLower.includes("code") || taskLower.includes("fix")) {
    keywords.push("code-generation", "implementation", "debugging");
  }
  if (
    taskLower.includes("research") ||
    taskLower.includes("find") ||
    taskLower.includes("analyze")
  ) {
    keywords.push("research", "analysis", "information-gathering");
  }
  if (
    taskLower.includes("plan") ||
    taskLower.includes("design") ||
    taskLower.includes("architect")
  ) {
    keywords.push("planning", "design", "architecture");
  }
  if (
    taskLower.includes("test") ||
    taskLower.includes("verify") ||
    taskLower.includes("validate")
  ) {
    keywords.push("testing", "verification", "quality");
  }

  return `Need: ${keywords.join(", ")}. Task: ${task.slice(0, 100)}`;
}

/**
 * Convert agent profile to key descriptor
 */
function profileToKey(profile: AgentProfile): string {
  return `Offer: ${profile.capabilities.join(", ")}. Strengths: ${profile.strengths.join(", ")}. Best for: ${profile.bestFor.join(", ")}`;
}

/**
 * Select best agent for a task using DyTopo semantic matching
 */
export function selectAgentForTask(
  task: string,
  availableAgents?: string[],
  config?: Partial<DyTopoConfig>,
): { agentId: string; confidence: number; reasoning: string } {
  const router = createDyTopoRouter({
    edgeThreshold: 0.1, // Very low threshold to ensure matching with keyword similarity
    maxEdgesPerAgent: 1,
    useEmbeddings: false,
    logTopology: false,
    ...config,
  });

  // Filter to available agents if specified
  const agents = availableAgents
    ? AGENT_REGISTRY.filter((a) => availableAgents.includes(a.agentId))
    : AGENT_REGISTRY;

  if (agents.length === 0) {
    return {
      agentId: "default",
      confidence: 0.5,
      reasoning: "No matching agents available, using default",
    };
  }

  // Create task descriptor (as consumer)
  const taskDescriptor: AgentDescriptor = {
    agentId: "task",
    role: "consumer",
    query: taskToQuery(task),
    key: "", // Task doesn't offer anything
  };

  // Create agent descriptors (as providers)
  const agentDescriptors: AgentDescriptor[] = agents.map((profile) => ({
    agentId: profile.agentId,
    role: "provider",
    query: "", // Agents don't need anything in this context
    key: profileToKey(profile),
  }));

  // Induce topology to find best matches
  const allDescriptors = [taskDescriptor, ...agentDescriptors];
  const graph = router.induceTopology(0, task, allDescriptors);

  // Find edges pointing TO the task (agents that can serve it)
  const matchingEdges = graph.edges
    .filter((e) => e.to === "task")
    .sort((a, b) => b.similarity - a.similarity);

  if (matchingEdges.length === 0) {
    return {
      agentId: "default",
      confidence: 0.5,
      reasoning: "No semantic matches found, using default",
    };
  }

  const bestMatch = matchingEdges[0];
  const matchedAgent = agents.find((a) => a.agentId === bestMatch.from);

  log.info(
    `[DyTopo] Selected agent ${bestMatch.from} for task (${(bestMatch.similarity * 100).toFixed(0)}% match)`,
  );

  return {
    agentId: bestMatch.from,
    confidence: bestMatch.similarity,
    reasoning: `Matched ${matchedAgent?.name || bestMatch.from} based on capabilities: ${matchedAgent?.capabilities.slice(0, 3).join(", ")}`,
  };
}
