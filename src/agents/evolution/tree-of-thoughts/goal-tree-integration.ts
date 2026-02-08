/**
 * Goal Tree Integration
 * Connects the Tree of Thoughts system with the existing goal stack
 */

import { TreeOfThoughtsState, ThoughtNode } from "./tree-of-thoughts";
import { treeOfThoughtsManager } from "./tree-of-thoughts-impl";

// Extended goal operations that support Tree of Thoughts
export interface GoalTreeOperations {
  // Enhanced goal operations
  pushGoalWithTree(description: string, initialThoughts?: string[]): Promise<GoalTreeResult>;
  expandGoalTree(
    goalId: string,
    thoughtDescription: string,
    reasoning: string,
    approach: string,
  ): Promise<ThoughtNode>;
  evaluateGoalProgress(goalId: string): Promise<GoalProgressEvaluation>;

  // Tree navigation
  exploreAlternatives(goalId: string, count?: number): Promise<AlternativeAnalysis>;
  backtrackGoal(goalId: string, steps?: number): Promise<string>;
  switchToAlternative(goalId: string, thoughtId: string): Promise<void>;

  // Analysis and reporting
  getGoalInsights(goalId: string): Promise<GoalInsights>;
  visualizeGoalTree(goalId: string): Promise<string>;
}

export interface GoalTreeResult {
  goalId: string;
  treeState: TreeOfThoughtsState;
  rootThoughts: ThoughtNode[];
  nextSteps: string[];
}

export interface GoalProgressEvaluation {
  goalId: string;
  overallProgress: number;
  bestPathScore: number;
  alternativeCount: number;
  blockers: string[];
  recommendations: string[];
  confidenceLevel: number;
}

export interface AlternativeAnalysis {
  goalId: string;
  alternatives: Array<{
    thoughtId: string;
    description: string;
    score: number;
    tradeoffs: string[];
  }>;
  recommendedAlternative?: string;
}

export interface GoalInsights {
  goalId: string;
  explorationSummary: {
    totalPaths: number;
    averageQuality: number;
    explorationDepth: number;
    efficiencyScore: number;
  };
  strengthsWeaknesses: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  nextSteps: string[];
  riskAssessment: string[];
}

export class GoalTreeIntegration implements GoalTreeOperations {
  async pushGoalWithTree(
    description: string,
    initialThoughts: string[] = [],
  ): Promise<GoalTreeResult> {
    // For integration, we'll simulate pushing to the existing goal stack
    // In practice, this would call the actual goal_push tool
    const goalId = `goal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create the tree
    const initialThought = initialThoughts[0] || `Initial approach: ${description}`;
    const treeState = await treeOfThoughtsManager.createTree(goalId, initialThought);

    // Add additional initial thoughts as branches
    const rootThoughts: ThoughtNode[] = [treeState.thoughts.get(treeState.rootThoughtId)!];

    for (let i = 1; i < initialThoughts.length; i++) {
      const thought = await treeOfThoughtsManager.addThought(
        treeState.rootThoughtId,
        initialThoughts[i],
        `Alternative initial approach ${i}`,
        `Different perspective on: ${description}`,
      );
      rootThoughts.push(thought);
    }

    const nextSteps = this.generateNextSteps(treeState);

    return {
      goalId,
      treeState,
      rootThoughts,
      nextSteps,
    };
  }

  async expandGoalTree(
    goalId: string,
    thoughtDescription: string,
    reasoning: string,
    approach: string,
  ): Promise<ThoughtNode> {
    const tree = treeOfThoughtsManager.getTree(goalId);
    if (!tree) {
      throw new Error(`No tree found for goal ${goalId}`);
    }

    // Add thought to current position
    const parentThoughtId = tree.currentThoughtId;
    return await treeOfThoughtsManager.addThought(
      parentThoughtId,
      thoughtDescription,
      reasoning,
      approach,
    );
  }

  async evaluateGoalProgress(goalId: string): Promise<GoalProgressEvaluation> {
    const tree = treeOfThoughtsManager.getTree(goalId);
    if (!tree) {
      throw new Error(`No tree found for goal ${goalId}`);
    }

    const allThoughts = Array.from(tree.thoughts.values());
    const activeBranches = tree.activeBranches.length;

    // Calculate overall progress
    const thoughtScores = allThoughts.map((t) => t.evaluation.overallScore);
    const overallProgress =
      thoughtScores.reduce((sum, score) => sum + score, 0) / thoughtScores.length;

    // Get best path score
    const bestPath = await treeOfThoughtsManager.getBestPath();
    const bestPathScore =
      bestPath.length > 0
        ? bestPath.reduce((sum, thoughtId) => {
            const thought = tree.thoughts.get(thoughtId);
            return sum + (thought?.evaluation.overallScore || 0);
          }, 0) / bestPath.length
        : 0;

    // Identify blockers
    const blockers = this.identifyBlockers(tree);

    // Generate recommendations
    const recommendations = this.generateRecommendations(tree);

    return {
      goalId,
      overallProgress,
      bestPathScore,
      alternativeCount: activeBranches,
      blockers,
      recommendations,
      confidenceLevel: Math.min(0.9, overallProgress + 0.1),
    };
  }

  async exploreAlternatives(goalId: string, count: number = 3): Promise<AlternativeAnalysis> {
    const tree = treeOfThoughtsManager.getTree(goalId);
    if (!tree) {
      throw new Error(`No tree found for goal ${goalId}`);
    }

    // Get current thought and its siblings/alternatives
    const currentThought = tree.thoughts.get(tree.currentThoughtId);
    if (!currentThought) {
      throw new Error(`Current thought not found in tree`);
    }

    let alternatives: Array<{
      thoughtId: string;
      description: string;
      score: number;
      tradeoffs: string[];
    }> = [];

    // If current thought has parent, get siblings as alternatives
    if (currentThought.parentThoughtId) {
      const parent = tree.thoughts.get(currentThought.parentThoughtId);
      if (parent) {
        alternatives = parent.children
          .filter((id) => id !== tree.currentThoughtId)
          .map((id) => {
            const thought = tree.thoughts.get(id)!;
            return {
              thoughtId: id,
              description: thought.description,
              score: thought.evaluation.overallScore,
              tradeoffs: this.calculateTradeoffs(thought, currentThought),
            };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, count);
      }
    }

    // Find recommended alternative (highest scoring)
    const recommendedAlternative = alternatives.length > 0 ? alternatives[0].thoughtId : undefined;

    return {
      goalId,
      alternatives,
      recommendedAlternative,
    };
  }

  async backtrackGoal(goalId: string, steps: number = 1): Promise<string> {
    const tree = treeOfThoughtsManager.getTree(goalId);
    if (!tree) {
      throw new Error(`No tree found for goal ${goalId}`);
    }

    return await treeOfThoughtsManager.backtrack(steps);
  }

  async switchToAlternative(goalId: string, thoughtId: string): Promise<void> {
    const tree = treeOfThoughtsManager.getTree(goalId);
    if (!tree) {
      throw new Error(`No tree found for goal ${goalId}`);
    }

    await treeOfThoughtsManager.jumpToThought(thoughtId);
  }

  async getGoalInsights(goalId: string): Promise<GoalInsights> {
    const tree = treeOfThoughtsManager.getTree(goalId);
    if (!tree) {
      throw new Error(`No tree found for goal ${goalId}`);
    }

    const allThoughts = Array.from(tree.thoughts.values());
    const activeBranches = tree.activeBranches;

    // Exploration summary
    const scores = allThoughts.map((t) => t.evaluation.overallScore);
    const averageQuality = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const maxDepth = Math.max(...allThoughts.map((t) => t.depth));

    // SWOT analysis
    const strengthsWeaknesses = this.performSWOTAnalysis(tree);

    // Next steps
    const nextSteps = this.generateNextSteps(tree);

    // Risk assessment
    const riskAssessment = this.assessRisks(tree);

    return {
      goalId,
      explorationSummary: {
        totalPaths: activeBranches.length,
        averageQuality,
        explorationDepth: maxDepth,
        efficiencyScore: tree.stats.explorationEfficiency,
      },
      strengthsWeaknesses,
      nextSteps,
      riskAssessment,
    };
  }

  async visualizeGoalTree(goalId: string): Promise<string> {
    const tree = treeOfThoughtsManager.getTree(goalId);
    if (!tree) {
      throw new Error(`No tree found for goal ${goalId}`);
    }

    return this.generateTreeVisualization(tree);
  }

  // Helper methods
  private generateNextSteps(tree: TreeOfThoughtsState): string[] {
    const currentThought = tree.thoughts.get(tree.currentThoughtId);
    if (!currentThought) {
      return ["Initialize tree exploration"];
    }

    const steps: string[] = [];

    // Based on current thought evaluation
    if (currentThought.evaluation.overallScore < 0.5) {
      steps.push("Consider alternative approaches");
      steps.push("Re-evaluate current strategy");
    } else {
      steps.push("Expand current approach");
      steps.push("Explore implementation details");
    }

    // Based on tree structure
    if (currentThought.children.length === 0) {
      steps.push("Generate follow-up thoughts");
    }

    if (currentThought.depth > 0) {
      steps.push("Compare with alternative branches");
    }

    return steps;
  }

  private identifyBlockers(tree: TreeOfThoughtsState): string[] {
    const blockers: string[] = [];

    // Check for low-scoring thoughts
    const lowScoreThoughts = Array.from(tree.thoughts.values()).filter(
      (t) => t.evaluation.overallScore < 0.3,
    );

    if (lowScoreThoughts.length > 0) {
      blockers.push(`${lowScoreThoughts.length} low-quality thoughts identified`);
    }

    // Check for pruned branches
    if (tree.stats.prunedThoughts > 0) {
      blockers.push(`${tree.stats.prunedThoughts} thoughts have been pruned`);
    }

    // Check exploration efficiency
    if (tree.stats.explorationEfficiency < 0.3) {
      blockers.push("Low exploration efficiency detected");
    }

    return blockers;
  }

  private generateRecommendations(tree: TreeOfThoughtsState): string[] {
    const recommendations: string[] = [];

    const currentThought = tree.thoughts.get(tree.currentThoughtId);
    if (!currentThought) {
      return ["Initialize tree exploration"];
    }

    // Based on evaluation scores
    if (currentThought.evaluation.feasibility < 0.5) {
      recommendations.push("Focus on more feasible approaches");
    }

    if (currentThought.evaluation.novelty < 0.3) {
      recommendations.push("Explore more creative alternatives");
    }

    if (currentThought.evaluation.progress < 0.4) {
      recommendations.push("Break down into smaller, actionable steps");
    }

    // Based on tree structure
    if (
      currentThought.children.length < 2 &&
      tree.stats.totalThoughts < tree.config.maxTotalThoughts
    ) {
      recommendations.push("Generate alternative approaches");
    }

    return recommendations;
  }

  private calculateTradeoffs(thought1: ThoughtNode, thought2: ThoughtNode): string[] {
    const tradeoffs: string[] = [];

    const eval1 = thought1.evaluation;
    const eval2 = thought2.evaluation;

    if (eval1.feasibility > eval2.feasibility) {
      tradeoffs.push("Higher feasibility but may sacrifice novelty");
    } else {
      tradeoffs.push("Lower feasibility but potentially more innovative");
    }

    if (eval1.progress > eval2.progress) {
      tradeoffs.push("Better progress trajectory");
    } else {
      tradeoffs.push("May require more steps to show progress");
    }

    return tradeoffs;
  }

  private performSWOTAnalysis(tree: TreeOfThoughtsState): {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  } {
    const stats = tree.stats;
    const allThoughts = Array.from(tree.thoughts.values());

    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const opportunities: string[] = [];
    const threats: string[] = [];

    // Strengths
    if (stats.averageThoughtScore > 0.6) {
      strengths.push("High-quality thought generation");
    }
    if (stats.activeBranches > 2) {
      strengths.push("Multiple viable paths explored");
    }
    if (stats.explorationEfficiency > 0.5) {
      strengths.push("Efficient exploration strategy");
    }

    // Weaknesses
    if (stats.averageThoughtScore < 0.4) {
      weaknesses.push("Low average thought quality");
    }
    if (stats.prunedThoughts > stats.totalThoughts * 0.3) {
      weaknesses.push("High pruning rate indicates poor initial directions");
    }

    // Opportunities
    if (stats.totalThoughts < tree.config.maxTotalThoughts * 0.7) {
      opportunities.push("Room for additional exploration");
    }
    const maxDepth = Math.max(...allThoughts.map((t) => t.depth));
    if (maxDepth < tree.config.maxDepth) {
      opportunities.push("Can explore deeper into promising paths");
    }

    // Threats
    if (stats.activeBranches === 1) {
      threats.push("Limited alternatives if current path fails");
    }
    if (stats.explorationEfficiency < 0.3) {
      threats.push("Poor exploration efficiency may waste resources");
    }

    return { strengths, weaknesses, opportunities, threats };
  }

  private assessRisks(tree: TreeOfThoughtsState): string[] {
    const risks: string[] = [];

    // Technical risks
    if (tree.stats.activeBranches === 1) {
      risks.push("Single point of failure - no alternative paths");
    }

    if (tree.stats.averageThoughtScore < 0.4) {
      risks.push("Low-quality thoughts may lead to poor outcomes");
    }

    // Process risks
    const allThoughts = Array.from(tree.thoughts.values());
    const maxDepth = Math.max(...allThoughts.map((t) => t.depth));
    if (maxDepth > tree.config.maxDepth * 0.8) {
      risks.push("Approaching maximum depth - may hit exploration limits");
    }

    if (tree.stats.totalThoughts > tree.config.maxTotalThoughts * 0.8) {
      risks.push("Approaching thought limit - may need to prune or conclude");
    }

    return risks;
  }

  private generateTreeVisualization(tree: TreeOfThoughtsState): string {
    let visualization = `# Goal Tree Visualization\n\n`;
    visualization += `**Goal ID:** ${tree.goalId}\n`;
    visualization += `**Total Thoughts:** ${tree.stats.totalThoughts}\n`;
    visualization += `**Active Branches:** ${tree.stats.activeBranches}\n`;
    visualization += `**Average Score:** ${tree.stats.averageThoughtScore.toFixed(2)}\n\n`;

    // Root thought
    const rootThought = tree.thoughts.get(tree.rootThoughtId);
    if (rootThought) {
      visualization += this.renderThoughtNode(rootThought, tree, 0, "");
    }

    return visualization;
  }

  private renderThoughtNode(
    thought: ThoughtNode,
    tree: TreeOfThoughtsState,
    depth: number,
    prefix: string,
  ): string {
    const isCurrent = thought.id === tree.currentThoughtId;
    const statusIcon = this.getStatusIcon(thought.status, isCurrent);
    const scoreBar = this.getScoreBar(thought.evaluation.overallScore);

    let result = `${prefix}${statusIcon} ${thought.description} ${scoreBar}\n`;

    // Add children
    thought.children.forEach((childId, index) => {
      const child = tree.thoughts.get(childId);
      if (child) {
        const isLast = index === thought.children.length - 1;
        const childPrefix = prefix + (isLast ? "    " : "│   ");
        const connector = isLast ? "└── " : "├── ";
        result += this.renderThoughtNode(child, tree, depth + 1, prefix + connector);
      }
    });

    return result;
  }

  private getStatusIcon(status: string, isCurrent: boolean): string {
    if (isCurrent) return "➤";

    switch (status) {
      case "active":
        return "○";
      case "completed":
        return "✓";
      case "pruned":
        return "✗";
      case "failed":
        return "✗";
      default:
        return "○";
    }
  }

  private getScoreBar(score: number): string {
    const width = 10;
    const filled = Math.round(score * width);
    const empty = width - filled;
    return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${(score * 100).toFixed(0)}%`;
  }
}

// Export singleton instance
export const goalTreeIntegration = new GoalTreeIntegration();
