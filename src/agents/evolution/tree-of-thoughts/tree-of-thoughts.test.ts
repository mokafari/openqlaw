/**
 * Tree of Thoughts Test Suite
 * Tests for basic branching support and core functionality
 */

import { goalTreeIntegration } from "./goal-tree-integration";
import { TreeOfThoughtsManager, treeOfThoughtsManager } from "./tree-of-thoughts-impl";

// Mock UUID for consistent testing
jest.mock("uuid", () => ({
  v4: jest.fn(() => "mock-uuid-" + Math.random().toString(36).substr(2, 9)),
}));

describe("Tree of Thoughts - Basic Branching", () => {
  let manager: TreeOfThoughtsManager;
  const testGoalId = "test-goal-001";

  beforeEach(() => {
    manager = new TreeOfThoughtsManager();
  });

  afterEach(() => {
    // Clean up any test trees
    manager.destroyTree(testGoalId);
  });

  describe("Tree Creation and Basic Structure", () => {
    test("should create a tree with root thought", async () => {
      const initialThought = "Implement Tree of Thoughts extension";
      const tree = await manager.createTree(testGoalId, initialThought);

      expect(tree.goalId).toBe(testGoalId);
      expect(tree.thoughts.size).toBe(1);
      expect(tree.branches.size).toBe(1);
      expect(tree.activeBranches).toHaveLength(1);

      const rootThought = tree.thoughts.get(tree.rootThoughtId);
      expect(rootThought).toBeDefined();
      expect(rootThought?.description).toBe(initialThought);
      expect(rootThought?.depth).toBe(0);
      expect(rootThought?.status).toBe("active");
    });

    test("should have proper initial evaluations", async () => {
      const tree = await manager.createTree(testGoalId, "Test thought");
      const rootThought = tree.thoughts.get(tree.rootThoughtId);

      expect(rootThought?.evaluation).toBeDefined();
      expect(rootThought?.evaluation.overallScore).toBeGreaterThan(0);
      expect(rootThought?.evaluation.confidence).toBeGreaterThan(0);
      expect(rootThought?.evaluation.pros).toHaveLength(3);
      expect(rootThought?.evaluation.cons).toHaveLength(3);
      expect(rootThought?.evaluation.risks).toHaveLength(3);
    });
  });

  describe("Branching Functionality", () => {
    let tree: any;
    let rootThoughtId: string;

    beforeEach(async () => {
      tree = await manager.createTree(testGoalId, "Root thought for branching test");
      rootThoughtId = tree.rootThoughtId;
    });

    test("should add child thoughts (branches)", async () => {
      const childThought1 = await manager.addThought(
        rootThoughtId,
        "First branch: Direct implementation",
        "Start with basic data structures",
        "Create interfaces and basic classes first",
      );

      const childThought2 = await manager.addThought(
        rootThoughtId,
        "Second branch: Research-first approach",
        "Study existing implementations before coding",
        "Analyze papers and existing code patterns",
      );

      // Verify tree structure
      const updatedTree = manager.getTree(testGoalId);
      expect(updatedTree?.thoughts.size).toBe(3); // root + 2 children

      const rootThought = updatedTree?.thoughts.get(rootThoughtId);
      expect(rootThought?.children).toHaveLength(2);
      expect(rootThought?.children).toContain(childThought1.id);
      expect(rootThought?.children).toContain(childThought2.id);

      // Verify child properties
      expect(childThought1.depth).toBe(1);
      expect(childThought1.branchIndex).toBe(0);
      expect(childThought2.depth).toBe(1);
      expect(childThought2.branchIndex).toBe(1);
    });

    test("should create multiple levels of branching", async () => {
      // First level
      const level1Branch = await manager.addThought(
        rootThoughtId,
        "Level 1 thought",
        "First level reasoning",
        "First level approach",
      );

      // Second level
      const level2Branch = await manager.addThought(
        level1Branch.id,
        "Level 2 thought",
        "Second level reasoning",
        "Second level approach",
      );

      // Third level
      const level3Branch = await manager.addThought(
        level2Branch.id,
        "Level 3 thought",
        "Third level reasoning",
        "Third level approach",
      );

      const updatedTree = manager.getTree(testGoalId);
      expect(updatedTree?.thoughts.size).toBe(4); // root + 3 levels

      expect(level1Branch.depth).toBe(1);
      expect(level2Branch.depth).toBe(2);
      expect(level3Branch.depth).toBe(3);

      expect(level3Branch.parentThoughtId).toBe(level2Branch.id);
      expect(level2Branch.parentThoughtId).toBe(level1Branch.id);
      expect(level1Branch.parentThoughtId).toBe(rootThoughtId);
    });

    test("should enforce maximum branches per node", async () => {
      const config = { maxBranchesPerNode: 2 };
      const limitedManager = new TreeOfThoughtsManager(config);

      const tree = await limitedManager.createTree(testGoalId, "Test branching limits");
      const rootId = tree.rootThoughtId;

      // Add maximum allowed branches
      await limitedManager.addThought(rootId, "Branch 1", "Reasoning 1", "Approach 1");
      await limitedManager.addThought(rootId, "Branch 2", "Reasoning 2", "Approach 2");

      // Third branch should fail
      await expect(
        limitedManager.addThought(rootId, "Branch 3", "Reasoning 3", "Approach 3"),
      ).rejects.toThrow("Maximum branches per node");

      limitedManager.destroyTree(testGoalId);
    });

    test("should enforce maximum depth", async () => {
      const config = { maxDepth: 2 };
      const limitedManager = new TreeOfThoughtsManager(config);

      const tree = await limitedManager.createTree(testGoalId, "Test depth limits");
      let currentId = tree.rootThoughtId;

      // Should be able to reach max depth
      const level1 = await limitedManager.addThought(currentId, "Level 1", "R1", "A1");
      const level2 = await limitedManager.addThought(level1.id, "Level 2", "R2", "A2");

      // Going beyond max depth should fail
      await expect(limitedManager.addThought(level2.id, "Level 3", "R3", "A3")).rejects.toThrow(
        "Maximum depth",
      );

      limitedManager.destroyTree(testGoalId);
    });
  });

  describe("Thought Evaluation", () => {
    test("should evaluate thoughts with different approaches", async () => {
      const tree = await manager.createTree(testGoalId, "Root for evaluation test");

      // Add thought with implementation keywords (should score higher on feasibility)
      const implementationThought = await manager.addThought(
        tree.rootThoughtId,
        "Implement basic data structures",
        "Start by creating the core interfaces and classes",
        "Create TypeScript interfaces first, then implement classes",
      );

      // Add thought with research keywords (should score differently)
      const researchThought = await manager.addThought(
        tree.rootThoughtId,
        "Research existing solutions",
        "Analyze current Tree of Thoughts implementations",
        "Study papers and existing codebases for patterns",
      );

      expect(implementationThought.evaluation.overallScore).toBeGreaterThan(0);
      expect(researchThought.evaluation.overallScore).toBeGreaterThan(0);

      // Should have different evaluation profiles
      expect(implementationThought.evaluation).not.toEqual(researchThought.evaluation);
    });

    test("should detect novelty based on similarity", async () => {
      const tree = await manager.createTree(testGoalId, "Test novelty detection");

      // Add first thought
      const firstThought = await manager.addThought(
        tree.rootThoughtId,
        "Implement data structures",
        "Create basic classes",
        "Start with interfaces",
      );

      // Add very similar thought (should have lower novelty)
      const similarThought = await manager.addThought(
        tree.rootThoughtId,
        "Implement data structures and classes",
        "Create basic class implementations",
        "Start with interface definitions",
      );

      // Add completely different thought (should have higher novelty)
      const differentThought = await manager.addThought(
        tree.rootThoughtId,
        "Write comprehensive tests",
        "Focus on test-driven development",
        "Begin with unit test specifications",
      );

      // Different thought should have higher novelty than similar thought
      expect(differentThought.evaluation.novelty).toBeGreaterThan(
        similarThought.evaluation.novelty,
      );
    });
  });

  describe("Navigation and Backtracking", () => {
    let tree: any;

    beforeEach(async () => {
      tree = await manager.createTree(testGoalId, "Navigation test root");
    });

    test("should track current position and history", async () => {
      const rootId = tree.rootThoughtId;

      const thought1 = await manager.addThought(rootId, "Thought 1", "R1", "A1");
      const thought2 = await manager.addThought(thought1.id, "Thought 2", "R2", "A2");

      const updatedTree = manager.getTree(testGoalId);
      expect(updatedTree?.currentThoughtId).toBe(thought2.id);
      expect(updatedTree?.explorationHistory).toEqual([rootId, thought1.id, thought2.id]);
    });

    test("should backtrack correctly", async () => {
      const rootId = tree.rootThoughtId;

      const thought1 = await manager.addThought(rootId, "Thought 1", "R1", "A1");
      const thought2 = await manager.addThought(thought1.id, "Thought 2", "R2", "A2");

      // Backtrack one step
      const newCurrentId = await manager.backtrack(1);

      const updatedTree = manager.getTree(testGoalId);
      expect(newCurrentId).toBe(thought1.id);
      expect(updatedTree?.currentThoughtId).toBe(thought1.id);
      expect(updatedTree?.explorationHistory).toEqual([rootId, thought1.id]);
    });

    test("should jump to specific thoughts", async () => {
      const rootId = tree.rootThoughtId;

      const thought1 = await manager.addThought(rootId, "Thought 1", "R1", "A1");
      const thought2 = await manager.addThought(rootId, "Thought 2", "R2", "A2");

      await manager.jumpToThought(thought2.id);

      const updatedTree = manager.getTree(testGoalId);
      expect(updatedTree?.currentThoughtId).toBe(thought2.id);
    });
  });

  describe("Pruning", () => {
    test("should prune low-scoring thoughts", async () => {
      const tree = await manager.createTree(testGoalId, "Pruning test");

      const thought = await manager.addThought(
        tree.rootThoughtId,
        "Low quality thought",
        "Poor reasoning",
        "Unclear approach",
      );

      await manager.pruneThought(thought.id, "Manual pruning test");

      const updatedTree = manager.getTree(testGoalId);
      const prunedThought = updatedTree?.thoughts.get(thought.id);
      expect(prunedThought?.status).toBe("pruned");
      expect(updatedTree?.stats.prunedThoughts).toBe(1);
    });

    test("should backtrack when current thought is pruned", async () => {
      const tree = await manager.createTree(testGoalId, "Backtrack on prune test");
      const rootId = tree.rootThoughtId;

      const thought1 = await manager.addThought(rootId, "Thought 1", "R1", "A1");
      const thought2 = await manager.addThought(thought1.id, "Thought 2", "R2", "A2");

      // Current position should be at thought2
      expect(manager.getTree(testGoalId)?.currentThoughtId).toBe(thought2.id);

      // Prune current thought
      await manager.pruneThought(thought2.id, "Test pruning current");

      // Should backtrack to thought1
      const updatedTree = manager.getTree(testGoalId);
      expect(updatedTree?.currentThoughtId).toBe(thought1.id);
    });
  });
});

describe("Goal Tree Integration", () => {
  test("should create goal with tree structure", async () => {
    const result = await goalTreeIntegration.pushGoalWithTree("Implement Tree of Thoughts system", [
      "Start with data structures",
      "Begin with research phase",
      "Focus on test-driven approach",
    ]);

    expect(result.goalId).toBeDefined();
    expect(result.treeState).toBeDefined();
    expect(result.rootThoughts).toHaveLength(3);
    expect(result.nextSteps).toHaveLength(4);
    expect(result.treeState.thoughts.size).toBe(3); // root + 2 additional thoughts
  });

  test("should evaluate goal progress", async () => {
    const result = await goalTreeIntegration.pushGoalWithTree("Test goal progress evaluation", [
      "Initial approach",
    ]);

    const progress = await goalTreeIntegration.evaluateGoalProgress(result.goalId);

    expect(progress.goalId).toBe(result.goalId);
    expect(progress.overallProgress).toBeGreaterThan(0);
    expect(progress.alternativeCount).toBeGreaterThan(0);
    expect(progress.recommendations).toHaveLength(4);
    expect(progress.confidenceLevel).toBeGreaterThan(0);
  });

  test("should generate tree visualization", async () => {
    const result = await goalTreeIntegration.pushGoalWithTree("Visualization test goal", [
      "First approach",
      "Second approach",
    ]);

    // Add a child thought to create more structure
    await goalTreeIntegration.expandGoalTree(
      result.goalId,
      "Detailed implementation step",
      "Breaking down the first approach",
      "Create specific implementation plan",
    );

    const visualization = await goalTreeIntegration.visualizeGoalTree(result.goalId);

    expect(visualization).toContain("Goal Tree Visualization");
    expect(visualization).toContain(result.goalId);
    expect(visualization).toContain("Total Thoughts:");
    expect(visualization).toContain("➤"); // Current thought indicator
    expect(visualization).toContain("○"); // Active thought indicator
  });

  test("should provide goal insights", async () => {
    const result = await goalTreeIntegration.pushGoalWithTree("Insights test goal", [
      "Approach 1",
      "Approach 2",
      "Approach 3",
    ]);

    const insights = await goalTreeIntegration.getGoalInsights(result.goalId);

    expect(insights.goalId).toBe(result.goalId);
    expect(insights.explorationSummary).toBeDefined();
    expect(insights.strengthsWeaknesses).toBeDefined();
    expect(insights.nextSteps).toHaveLength(4);
    expect(insights.riskAssessment).toHaveLength(2);

    // Should have SWOT analysis
    expect(insights.strengthsWeaknesses.strengths).toBeDefined();
    expect(insights.strengthsWeaknesses.weaknesses).toBeDefined();
    expect(insights.strengthsWeaknesses.opportunities).toBeDefined();
    expect(insights.strengthsWeaknesses.threats).toBeDefined();
  });
});

describe("Tree Configuration and Limits", () => {
  test("should respect custom configuration", async () => {
    const customConfig = {
      maxBranchesPerNode: 2,
      maxDepth: 3,
      maxTotalThoughts: 5,
      evaluationThreshold: 0.6,
      pruningThreshold: 0.3,
    };

    const customManager = new TreeOfThoughtsManager(customConfig);
    const tree = await customManager.createTree("custom-test", "Custom config test");

    expect(tree.config.maxBranchesPerNode).toBe(2);
    expect(tree.config.maxDepth).toBe(3);
    expect(tree.config.maxTotalThoughts).toBe(5);
    expect(tree.config.evaluationThreshold).toBe(0.6);
    expect(tree.config.pruningThreshold).toBe(0.3);

    customManager.destroyTree("custom-test");
  });

  test("should update statistics correctly", async () => {
    const tree = await treeOfThoughtsManager.createTree("stats-test", "Statistics test");

    // Initial stats
    expect(tree.stats.totalThoughts).toBe(1);
    expect(tree.stats.activeBranches).toBe(1);
    expect(tree.stats.prunedThoughts).toBe(0);

    // Add thoughts and verify stats update
    await treeOfThoughtsManager.addThought(
      tree.rootThoughtId,
      "Test thought",
      "Test reasoning",
      "Test approach",
    );

    const updatedTree = treeOfThoughtsManager.getTree("stats-test");
    expect(updatedTree?.stats.totalThoughts).toBe(2);
    expect(updatedTree?.stats.averageThoughtScore).toBeGreaterThan(0);

    treeOfThoughtsManager.destroyTree("stats-test");
  });
});

console.log("Tree of Thoughts test suite ready for execution");
