/**
 * Tree of Thoughts Implementation
 * Core implementation of the Tree of Thoughts extension for the goal stack
 */

import { v4 as uuidv4 } from "uuid";
import {
  ThoughtNode,
  ThoughtEvaluation,
  ThoughtBranch,
  TreeOfThoughtsState,
  TreeConfig,
  TreeStats,
  TreeOfThoughtsOperations,
  BranchAnalysis,
  DEFAULT_TREE_CONFIG,
} from "./tree-of-thoughts";

export class TreeOfThoughtsManager implements TreeOfThoughtsOperations {
  private trees: Map<string, TreeOfThoughtsState> = new Map();
  private config: TreeConfig;

  constructor(config: Partial<TreeConfig> = {}) {
    this.config = { ...DEFAULT_TREE_CONFIG, ...config };
  }

  // Core tree management
  async createTree(goalId: string, initialThought: string): Promise<TreeOfThoughtsState> {
    const rootThoughtId = uuidv4();

    // Create root thought
    const rootThought: ThoughtNode = {
      id: rootThoughtId,
      goalId,
      children: [],
      description: initialThought,
      reasoning: "Initial approach to the goal",
      approach: "Starting point for tree exploration",
      evaluation: {
        feasibility: 0.5,
        novelty: 0.5,
        progress: 0.0,
        coherence: 0.5,
        overallScore: 0.5,
        confidence: 0.7,
        reasoning: "Initial evaluation - baseline scores",
        pros: ["Starting point established"],
        cons: ["No concrete progress yet"],
        risks: ["May need refinement"],
      },
      depth: 0,
      branchIndex: 0,
      createdAt: new Date(),
      status: "active",
    };

    // Create initial branch
    const initialBranch: ThoughtBranch = {
      id: uuidv4(),
      parentThoughtId: rootThoughtId,
      thoughts: [rootThoughtId],
      branchScore: 0.5,
      progressScore: 0.0,
      riskScore: 0.2,
      status: "active",
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };

    // Create tree state
    const treeState: TreeOfThoughtsState = {
      goalId,
      rootThoughtId,
      thoughts: new Map([[rootThoughtId, rootThought]]),
      branches: new Map([[initialBranch.id, initialBranch]]),
      activeBranches: [initialBranch.id],
      currentThoughtId: rootThoughtId,
      explorationHistory: [rootThoughtId],
      config: this.config,
      stats: {
        totalThoughts: 1,
        activeBranches: 1,
        completedBranches: 0,
        prunedThoughts: 0,
        averageThoughtScore: 0.5,
        bestBranchScore: 0.5,
        explorationEfficiency: 0.0,
        totalExplorationTime: 0,
        averageEvaluationTime: 0,
      },
    };

    this.trees.set(goalId, treeState);
    return treeState;
  }

  async destroyTree(goalId: string): Promise<void> {
    this.trees.delete(goalId);
  }

  // Thought operations
  async addThought(
    parentThoughtId: string,
    description: string,
    reasoning: string,
    approach: string,
  ): Promise<ThoughtNode> {
    const tree = this.findTreeByThoughtId(parentThoughtId);
    if (!tree) {
      throw new Error(`No tree found containing thought ${parentThoughtId}`);
    }

    const parentThought = tree.thoughts.get(parentThoughtId);
    if (!parentThought) {
      throw new Error(`Parent thought ${parentThoughtId} not found`);
    }

    // Check constraints
    if (parentThought.children.length >= this.config.maxBranchesPerNode) {
      throw new Error(`Maximum branches per node (${this.config.maxBranchesPerNode}) exceeded`);
    }

    if (parentThought.depth >= this.config.maxDepth) {
      throw new Error(`Maximum depth (${this.config.maxDepth}) exceeded`);
    }

    if (tree.thoughts.size >= this.config.maxTotalThoughts) {
      throw new Error(`Maximum total thoughts (${this.config.maxTotalThoughts}) exceeded`);
    }

    const thoughtId = uuidv4();
    const newThought: ThoughtNode = {
      id: thoughtId,
      goalId: tree.goalId,
      parentThoughtId,
      children: [],
      description,
      reasoning,
      approach,
      evaluation: await this.generateEvaluation(description, reasoning, approach, tree),
      depth: parentThought.depth + 1,
      branchIndex: parentThought.children.length,
      createdAt: new Date(),
      status: "active",
    };

    // Add to tree
    tree.thoughts.set(thoughtId, newThought);
    parentThought.children.push(thoughtId);

    // Update current position
    tree.currentThoughtId = thoughtId;
    tree.explorationHistory.push(thoughtId);

    // Update statistics
    tree.stats.totalThoughts += 1;
    this.updateTreeStats(tree);

    return newThought;
  }

  async evaluateThought(thoughtId: string): Promise<ThoughtEvaluation> {
    const tree = this.findTreeByThoughtId(thoughtId);
    if (!tree) {
      throw new Error(`No tree found containing thought ${thoughtId}`);
    }

    const thought = tree.thoughts.get(thoughtId);
    if (!thought) {
      throw new Error(`Thought ${thoughtId} not found`);
    }

    // Re-evaluate the thought
    const evaluation = await this.generateEvaluation(
      thought.description,
      thought.reasoning,
      thought.approach,
      tree,
    );

    thought.evaluation = evaluation;
    thought.lastEvaluatedAt = new Date();

    // Check if thought should be pruned
    if (evaluation.overallScore < this.config.pruningThreshold) {
      await this.pruneThought(thoughtId, "Score below pruning threshold");
    }

    return evaluation;
  }

  async pruneThought(thoughtId: string, reason: string): Promise<void> {
    const tree = this.findTreeByThoughtId(thoughtId);
    if (!tree) {
      throw new Error(`No tree found containing thought ${thoughtId}`);
    }

    const thought = tree.thoughts.get(thoughtId);
    if (!thought) {
      throw new Error(`Thought ${thoughtId} not found`);
    }

    // Mark as pruned
    thought.status = "pruned";

    // Recursively prune children
    for (const childId of thought.children) {
      await this.pruneThought(childId, "Parent pruned");
    }

    // Update statistics
    tree.stats.prunedThoughts += 1;

    // If current thought is pruned, backtrack
    if (tree.currentThoughtId === thoughtId) {
      await this.backtrack(1);
    }

    this.updateTreeStats(tree);
  }

  // Branch operations
  async createBranch(parentThoughtId: string): Promise<ThoughtBranch> {
    const tree = this.findTreeByThoughtId(parentThoughtId);
    if (!tree) {
      throw new Error(`No tree found containing thought ${parentThoughtId}`);
    }

    const branch: ThoughtBranch = {
      id: uuidv4(),
      parentThoughtId,
      thoughts: [parentThoughtId],
      branchScore: 0.5,
      progressScore: 0.0,
      riskScore: 0.3,
      status: "active",
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };

    tree.branches.set(branch.id, branch);
    tree.activeBranches.push(branch.id);
    tree.stats.activeBranches += 1;

    return branch;
  }

  async switchBranch(branchId: string): Promise<void> {
    const tree = this.findTreeByBranchId(branchId);
    if (!tree) {
      throw new Error(`No tree found containing branch ${branchId}`);
    }

    const branch = tree.branches.get(branchId);
    if (!branch) {
      throw new Error(`Branch ${branchId} not found`);
    }

    // Switch to the last thought in the branch
    const lastThoughtId = branch.thoughts[branch.thoughts.length - 1];
    tree.currentThoughtId = lastThoughtId;
    tree.explorationHistory.push(lastThoughtId);

    branch.lastActiveAt = new Date();
  }

  async abandonBranch(branchId: string, reason: string): Promise<void> {
    const tree = this.findTreeByBranchId(branchId);
    if (!tree) {
      throw new Error(`No tree found containing branch ${branchId}`);
    }

    const branch = tree.branches.get(branchId);
    if (!branch) {
      throw new Error(`Branch ${branchId} not found`);
    }

    branch.status = "abandoned";
    branch.abandonedReason = reason;

    // Remove from active branches
    tree.activeBranches = tree.activeBranches.filter((id) => id !== branchId);
    tree.stats.activeBranches -= 1;

    // Prune all thoughts in this branch
    for (const thoughtId of branch.thoughts) {
      const thought = tree.thoughts.get(thoughtId);
      if (thought && thought.status !== "pruned") {
        await this.pruneThought(thoughtId, `Branch abandoned: ${reason}`);
      }
    }
  }

  // Navigation
  async backtrack(steps: number = 1): Promise<string> {
    // Find the tree containing current thought
    let tree: TreeOfThoughtsState | undefined;
    const treeArray = Array.from(this.trees.values());
    for (const t of treeArray) {
      if (t.explorationHistory.length > 0) {
        tree = t;
        break;
      }
    }

    if (!tree) {
      throw new Error("No active tree found for backtracking");
    }

    // Remove steps from history and move back
    const stepsToTake = Math.min(steps, tree.explorationHistory.length - 1);
    for (let i = 0; i < stepsToTake; i++) {
      tree.explorationHistory.pop();
    }

    // Set current to last in history
    const newCurrentId = tree.explorationHistory[tree.explorationHistory.length - 1];
    tree.currentThoughtId = newCurrentId;

    return newCurrentId;
  }

  async jumpToThought(thoughtId: string): Promise<void> {
    const tree = this.findTreeByThoughtId(thoughtId);
    if (!tree) {
      throw new Error(`No tree found containing thought ${thoughtId}`);
    }

    tree.currentThoughtId = thoughtId;
    tree.explorationHistory.push(thoughtId);
  }

  // Analysis
  async getBestPath(): Promise<string[]> {
    let bestTree: TreeOfThoughtsState | undefined;
    let bestScore = 0;

    // Find tree with best score
    const treeArray = Array.from(this.trees.values());
    for (const tree of treeArray) {
      if (tree.stats.bestBranchScore > bestScore) {
        bestScore = tree.stats.bestBranchScore;
        bestTree = tree;
      }
    }

    if (!bestTree) {
      return [];
    }

    // Find best branch
    let bestBranch: ThoughtBranch | undefined;
    bestScore = 0;
    const branchArray = Array.from(bestTree.branches.values());
    for (const branch of branchArray) {
      if (branch.branchScore > bestScore) {
        bestScore = branch.branchScore;
        bestBranch = branch;
      }
    }

    return bestBranch ? bestBranch.thoughts : [];
  }

  async getAlternativePaths(count: number): Promise<string[][]> {
    const allPaths: string[][] = [];

    const treeArray = Array.from(this.trees.values());
    for (const tree of treeArray) {
      const branches = Array.from(tree.branches.values())
        .filter((b: ThoughtBranch) => b.status === "active" || b.status === "completed")
        .sort((a: ThoughtBranch, b: ThoughtBranch) => b.branchScore - a.branchScore)
        .slice(0, count);

      allPaths.push(...branches.map((b: ThoughtBranch) => b.thoughts));
    }

    return allPaths.slice(0, count);
  }

  async analyzeBranchQuality(branchId: string): Promise<BranchAnalysis> {
    const tree = this.findTreeByBranchId(branchId);
    if (!tree) {
      throw new Error(`No tree found containing branch ${branchId}`);
    }

    const branch = tree.branches.get(branchId);
    if (!branch) {
      throw new Error(`Branch ${branchId} not found`);
    }

    // Analyze branch thoughts
    const thoughtScores = branch.thoughts.map(
      (id) => tree.thoughts.get(id)?.evaluation.overallScore || 0,
    );

    const avgScore = thoughtScores.reduce((sum, score) => sum + score, 0) / thoughtScores.length;

    return {
      branchId,
      quality: avgScore,
      risks: ["May require refinement", "Complexity could increase"],
      opportunities: ["Good foundation for expansion", "Clear progression visible"],
      nextSteps: ["Evaluate next thought", "Consider alternative approaches"],
      confidence: Math.min(0.9, avgScore + 0.1),
    };
  }

  // Utility methods
  private findTreeByThoughtId(thoughtId: string): TreeOfThoughtsState | undefined {
    const treeArray = Array.from(this.trees.values());
    for (const tree of treeArray) {
      if (tree.thoughts.has(thoughtId)) {
        return tree;
      }
    }
    return undefined;
  }

  private findTreeByBranchId(branchId: string): TreeOfThoughtsState | undefined {
    const treeArray = Array.from(this.trees.values());
    for (const tree of treeArray) {
      if (tree.branches.has(branchId)) {
        return tree;
      }
    }
    return undefined;
  }

  private async generateEvaluation(
    description: string,
    reasoning: string,
    approach: string,
    tree: TreeOfThoughtsState,
  ): Promise<ThoughtEvaluation> {
    // Simple heuristic evaluation - in practice, this could use more sophisticated methods
    const feasibility = this.calculateFeasibility(description, approach);
    const novelty = this.calculateNovelty(description, tree);
    const progress = this.calculateProgress(description, reasoning);
    const coherence = this.calculateCoherence(description, reasoning);

    const weights = this.config.evaluationWeights;
    const overallScore =
      feasibility * weights.feasibility +
      novelty * weights.novelty +
      progress * weights.progress +
      coherence * weights.coherence;

    return {
      feasibility,
      novelty,
      progress,
      coherence,
      overallScore,
      confidence: 0.7, // Conservative confidence for heuristic evaluation
      reasoning: `Evaluated based on feasibility (${feasibility.toFixed(2)}), novelty (${novelty.toFixed(2)}), progress (${progress.toFixed(2)}), and coherence (${coherence.toFixed(2)})`,
      pros: this.generatePros(description, approach),
      cons: this.generateCons(description, approach),
      risks: this.generateRisks(description, approach),
    };
  }

  private calculateFeasibility(description: string, approach: string): number {
    // Simple heuristics - could be replaced with more sophisticated analysis
    const keywords = ["implement", "create", "build", "design", "analyze"];
    const hasActionKeyword = keywords.some(
      (keyword) =>
        description.toLowerCase().includes(keyword) || approach.toLowerCase().includes(keyword),
    );

    return hasActionKeyword ? 0.7 : 0.5;
  }

  private calculateNovelty(description: string, tree: TreeOfThoughtsState): number {
    // Check similarity with existing thoughts
    const existingDescriptions = Array.from(tree.thoughts.values()).map((t) => t.description);
    const similarity = existingDescriptions.reduce((maxSim, existing) => {
      const sim = this.calculateTextSimilarity(description, existing);
      return Math.max(maxSim, sim);
    }, 0);

    return 1 - similarity; // Novel if different from existing
  }

  private calculateProgress(description: string, reasoning: string): number {
    // Simple heuristic based on action words and specificity
    const progressKeywords = ["step", "next", "then", "implement", "complete", "finish"];
    const hasProgressKeywords = progressKeywords.some(
      (keyword) =>
        description.toLowerCase().includes(keyword) || reasoning.toLowerCase().includes(keyword),
    );

    return hasProgressKeywords ? 0.6 : 0.4;
  }

  private calculateCoherence(description: string, reasoning: string): number {
    // Check if reasoning supports the description
    const reasoningLength = reasoning.length;
    const hasSubstantialReasoning = reasoningLength > 50;

    return hasSubstantialReasoning ? 0.7 : 0.5;
  }

  private calculateTextSimilarity(text1: string, text2: string): number {
    // Simple word overlap similarity
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const words1Array = Array.from(words1);
    const words2Array = Array.from(words2);
    const intersection = new Set(words1Array.filter((x) => words2.has(x)));
    const union = new Set([...words1Array, ...words2Array]);

    return intersection.size / union.size;
  }

  private generatePros(description: string, approach: string): string[] {
    return [
      "Clear direction provided",
      "Builds on existing foundation",
      "Actionable steps identified",
    ];
  }

  private generateCons(description: string, approach: string): string[] {
    return [
      "May require additional research",
      "Implementation complexity unknown",
      "Resource requirements unclear",
    ];
  }

  private generateRisks(description: string, approach: string): string[] {
    return [
      "Technical challenges may emerge",
      "Timeline could extend",
      "Dependencies not fully mapped",
    ];
  }

  private updateTreeStats(tree: TreeOfThoughtsState): void {
    const allThoughts = Array.from(tree.thoughts.values());
    const activeThoughts = allThoughts.filter((t) => t.status === "active");

    tree.stats.averageThoughtScore =
      allThoughts.length > 0
        ? allThoughts.reduce((sum, t) => sum + t.evaluation.overallScore, 0) / allThoughts.length
        : 0;

    tree.stats.bestBranchScore = Math.max(
      ...Array.from(tree.branches.values()).map((b) => b.branchScore),
    );

    tree.stats.explorationEfficiency =
      tree.stats.totalThoughts > 0 ? tree.stats.averageThoughtScore / tree.stats.totalThoughts : 0;
  }

  // Public API for integration
  getTree(goalId: string): TreeOfThoughtsState | undefined {
    return this.trees.get(goalId);
  }

  getAllTrees(): TreeOfThoughtsState[] {
    return Array.from(this.trees.values());
  }
}

// Singleton instance for global use
export const treeOfThoughtsManager = new TreeOfThoughtsManager();
