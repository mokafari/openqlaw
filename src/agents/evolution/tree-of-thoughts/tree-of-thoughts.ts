/**
 * Tree of Thoughts Extension for Goal Stack
 * Based on Yao et al. 2023 - "Tree of Thoughts: Deliberate Problem Solving with Large Language Models"
 *
 * Extends the existing goal stack system with:
 * 1. Branching - multiple alternative paths from a goal
 * 2. Thought evaluation - score intermediate thoughts
 * 3. Backtracking - return to previous branch when quality drops
 */

// Core data structures for Tree of Thoughts

export interface ThoughtNode {
  id: string;
  goalId: string; // Links to existing goal system
  parentThoughtId?: string;
  children: string[]; // Child thought IDs

  // Thought content
  description: string;
  reasoning: string;
  approach: string;

  // Evaluation metrics
  evaluation: ThoughtEvaluation;

  // Tree structure
  depth: number;
  branchIndex: number; // Position among siblings

  // Timing
  createdAt: Date;
  lastEvaluatedAt?: Date;

  // Status
  status: "active" | "evaluated" | "pruned" | "completed" | "failed";
}

export interface ThoughtEvaluation {
  // Quality scores (0-1)
  feasibility: number; // How realistic is this approach?
  novelty: number; // How creative/original is this?
  progress: number; // How much progress does this make?
  coherence: number; // How well does this fit with the goal?

  // Combined metrics
  overallScore: number; // Weighted combination of above
  confidence: number; // How confident are we in this evaluation?

  // Comparison metrics
  relativeRank?: number; // Rank among sibling thoughts

  // Reasoning
  reasoning: string;
  pros: string[];
  cons: string[];
  risks: string[];
}

export interface ThoughtBranch {
  id: string;
  parentThoughtId: string;
  thoughts: string[]; // Ordered list of thought IDs in this branch

  // Branch evaluation
  branchScore: number; // Overall branch quality
  progressScore: number; // How much progress this branch makes
  riskScore: number; // How risky this branch is

  // Status
  status: "active" | "paused" | "abandoned" | "completed";

  // Metadata
  createdAt: Date;
  lastActiveAt: Date;
  abandonedReason?: string;
}

export interface TreeOfThoughtsState {
  goalId: string;
  rootThoughtId: string;

  // All thoughts in the tree
  thoughts: Map<string, ThoughtNode>;

  // Branch tracking
  branches: Map<string, ThoughtBranch>;
  activeBranches: string[];

  // Navigation
  currentThoughtId: string;
  explorationHistory: string[]; // Stack for backtracking

  // Configuration
  config: TreeConfig;

  // Statistics
  stats: TreeStats;
}

export interface TreeConfig {
  // Branching parameters
  maxBranchesPerNode: number; // Default: 3
  maxDepth: number; // Default: 5
  maxTotalThoughts: number; // Default: 20

  // Evaluation parameters
  evaluationThreshold: number; // Minimum score to continue (0-1)
  pruningThreshold: number; // Score below which to prune (0-1)

  // Exploration strategy
  explorationStrategy: "breadth-first" | "depth-first" | "best-first" | "adaptive";

  // Evaluation weights
  evaluationWeights: {
    feasibility: number;
    novelty: number;
    progress: number;
    coherence: number;
  };
}

export interface TreeStats {
  totalThoughts: number;
  activeBranches: number;
  completedBranches: number;
  prunedThoughts: number;

  // Quality metrics
  averageThoughtScore: number;
  bestBranchScore: number;
  explorationEfficiency: number; // Progress per thought

  // Time tracking
  totalExplorationTime: number;
  averageEvaluationTime: number;
}

// Default configuration
export const DEFAULT_TREE_CONFIG: TreeConfig = {
  maxBranchesPerNode: 3,
  maxDepth: 5,
  maxTotalThoughts: 20,
  evaluationThreshold: 0.4,
  pruningThreshold: 0.2,
  explorationStrategy: "best-first",
  evaluationWeights: {
    feasibility: 0.3,
    novelty: 0.2,
    progress: 0.3,
    coherence: 0.2,
  },
};

// Tree operations interface
export interface TreeOfThoughtsOperations {
  // Core tree management
  createTree(goalId: string, initialThought: string): Promise<TreeOfThoughtsState>;
  destroyTree(goalId: string): Promise<void>;

  // Thought operations
  addThought(
    parentThoughtId: string,
    description: string,
    reasoning: string,
    approach: string,
  ): Promise<ThoughtNode>;
  evaluateThought(thoughtId: string): Promise<ThoughtEvaluation>;
  pruneThought(thoughtId: string, reason: string): Promise<void>;

  // Branch operations
  createBranch(parentThoughtId: string): Promise<ThoughtBranch>;
  switchBranch(branchId: string): Promise<void>;
  abandonBranch(branchId: string, reason: string): Promise<void>;

  // Navigation
  backtrack(steps?: number): Promise<string>; // Returns new current thought ID
  jumpToThought(thoughtId: string): Promise<void>;

  // Analysis
  getBestPath(): Promise<string[]>; // Returns thought IDs of best path
  getAlternativePaths(count: number): Promise<string[][]>;
  analyzeBranchQuality(branchId: string): Promise<BranchAnalysis>;
}

export interface BranchAnalysis {
  branchId: string;
  quality: number;
  risks: string[];
  opportunities: string[];
  nextSteps: string[];
  confidence: number;
}
