#!/usr/bin/env node
/**
 * Interactive Quake Bot Integration Tests
 */

import { getContextDepthInfo, isContextPortal } from "../src/agents/aas/bsp-tree.js";
import { ContextGraph } from "../src/agents/aas/context-graph.js";
import { canReach, getReachableAreas } from "../src/agents/aas/reachability.js";
import { createFSMStateManager } from "../src/agents/fsm/state-manager.js";
import { analyzeTaskComplexity, selectModelFuzzy } from "../src/agents/fuzzy-selector.js";
import { GoalStack } from "../src/agents/goals/stack.js";
import { selectSynonym, DEFAULT_SYNONYMS } from "../src/agents/personality/synonyms.js";

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🎮 QUAKE BOT INTEGRATION - INTERACTIVE TESTS");
  console.log("═══════════════════════════════════════════════════════════\n");

  // ═══════════════════════════════════════════════════════════════
  // TEST 1: Goal Stack with Blocking/Unblocking
  // ═══════════════════════════════════════════════════════════════
  console.log("📚 TEST 1: Goal Stack with Obstacle Handling");
  console.log("─".repeat(60));

  const stack = new GoalStack("test-session");

  // Push main task
  const deployId = stack.push({ type: "task", description: "Deploy application to production" });
  stack.activate(deployId);
  console.log("1. Pushed: Deploy application to production");

  // Hit an obstacle!
  const obstacleId = stack.blockCurrent("Build failed - missing dependency: lodash");
  console.log("2. 🚧 Blocked by: Build failed - missing dependency: lodash");

  // Push fix for obstacle
  console.log("3. Working on obstacle...");

  // Resolve obstacle
  stack.unblock(obstacleId);
  console.log("4. ✅ Obstacle resolved! Resuming main task...");

  // Complete main task
  stack.complete(deployId);
  console.log("5. 🎉 Deployment complete!");

  console.log("\nFinal stack state:");
  for (const goal of stack.getAll()) {
    const icon = goal.status === "completed" ? "✅" : goal.status === "blocked" ? "🚧" : "⏳";
    console.log(`  ${icon} [${goal.type}] ${goal.description} → ${goal.status}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 2: FSM State Transitions (valid and invalid)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n\n🔄 TEST 2: FSM State Transitions");
  console.log("─".repeat(60));

  const fsm = createFSMStateManager({ sessionId: "test", initialState: "idle" });
  console.log(`Initial state: ${fsm.getState()} (Quake: ${fsm.getQuakeNode()})`);

  type AgentState =
    | "idle"
    | "gathering_info"
    | "planning"
    | "executing"
    | "verifying"
    | "camping"
    | "retreating"
    | "reporting"
    | "diagnostic"
    | "mutating"
    | "self_correcting";

  const transitions: Array<{ to: AgentState; expect: boolean }> = [
    { to: "planning", expect: true },
    { to: "executing", expect: true },
    { to: "camping", expect: true },
    { to: "idle", expect: true },
    { to: "executing", expect: false },
    { to: "gathering_info", expect: true },
  ];

  for (const t of transitions) {
    const before = fsm.getState();
    const success = await fsm.transitionTo(t.to);
    const icon = success === t.expect ? "✅" : "❌";
    console.log(`${icon} ${before} → ${t.to}: ${success ? "allowed" : "blocked"}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 3: Fuzzy Model Selection
  // ═══════════════════════════════════════════════════════════════
  console.log("\n\n🎯 TEST 3: Fuzzy Model Selection (Quake Weapon Logic)");
  console.log("─".repeat(60));

  const prompts = [
    "What time is it?",
    "Read the package.json file",
    "Refactor the entire authentication system with OAuth2 support",
    "Fix this critical bug ASAP",
    "Design and implement a new microservices architecture for the platform",
  ];

  for (const prompt of prompts) {
    const complexity = analyzeTaskComplexity(prompt);
    const model = selectModelFuzzy({
      taskComplexity: complexity,
      contextBudget: 0.7,
      userUrgency: prompt.includes("ASAP") ? 0.9 : 0.5,
    });
    const tier = model.model.includes("opus")
      ? "🔫 BFG10K"
      : model.model.includes("haiku")
        ? "🔧 Machine Gun"
        : "⚔️ Balanced";
    console.log(`${tier} │ complexity=${complexity.toFixed(2)} │ ${model.model}`);
    console.log(`   └─ "${prompt.slice(0, 50)}${prompt.length > 50 ? "..." : ""}"`);
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 4: Synonym Dictionary (Eliza-style variation)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n\n💬 TEST 4: Synonym Dictionary (10 random samples)");
  console.log("─".repeat(60));

  const contexts = [
    "START_TOOL",
    "TOOL_SUCCESS",
    "TOOL_ERROR",
    "PLANNING",
    "WAITING",
    "COMPLETED",
  ] as const;
  for (let i = 0; i < 10; i++) {
    const ctx = contexts[Math.floor(Math.random() * contexts.length)];
    const synonym = selectSynonym(ctx, DEFAULT_SYNONYMS);
    console.log(`[${ctx.padEnd(12)}] → "${synonym}"`);
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 5: BSP State Tree (Context Depth)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n\n🌲 TEST 5: BSP State Tree (Context Depth Partitioning)");
  console.log("─".repeat(60));

  const workspaceRoot = "/Users/gustav/openclaw";
  const paths = [
    "/etc/hosts",
    "/Users/gustav/openclaw/package.json",
    "/Users/gustav/openclaw/src/agents/camping.ts",
    "/Users/gustav/openclaw/src/agents/fsm/states.ts",
    "/Users/gustav/openclaw/SOUL.md",
  ];

  for (const p of paths) {
    const info = getContextDepthInfo(p, workspaceRoot);
    const portal = isContextPortal(p, workspaceRoot) ? " 🌀 PORTAL" : "";
    console.log(`L${info.depth} │ ${info.description}`);
    console.log(`   └─ ${p.replace(workspaceRoot, ".")}${portal}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 6: Reachability Graph
  // ═══════════════════════════════════════════════════════════════
  console.log("\n\n🗺️  TEST 6: Reachability Graph (Area Navigation)");
  console.log("─".repeat(60));

  const areas = ["filesystem", "browser", "terminal", "web", "messaging", "scheduling", "system"];
  console.log("Can reach from filesystem:");
  for (const target of areas) {
    if (target !== "filesystem") {
      const reachable = canReach("filesystem", target);
      console.log(`  ${reachable ? "✅" : "❌"} filesystem → ${target}`);
    }
  }

  console.log("\nDirect reachability from browser:");
  const browserReach = getReachableAreas("browser");
  for (const r of browserReach) {
    console.log(`  → ${r.to} (via ${r.via}, cost=${r.cost})`);
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 7: Context Graph Capability Checks
  // ═══════════════════════════════════════════════════════════════
  console.log("\n\n🔐 TEST 7: Context Graph Capability Checks");
  console.log("─".repeat(60));

  const ctx = { workspaceDir: workspaceRoot, hasNetwork: true };
  const capabilities = ["CanCommit", "CanDeploy", "CanRead", "CanWrite", "CanNetwork"] as const;

  for (const cap of capabilities) {
    const result = await ContextGraph.check(ctx, cap);
    const detailed = await ContextGraph.checkDetailed(ctx, cap);
    console.log(`${result ? "✅" : "❌"} ${cap}`);
    if (!result && detailed.missing.length > 0) {
      console.log(`   └─ Missing: ${detailed.missing.join(", ")}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 8: Complex Goal Stack Scenario
  // ═══════════════════════════════════════════════════════════════
  console.log("\n\n🎯 TEST 8: Complex Goal Stack (Multi-level obstacles)");
  console.log("─".repeat(60));

  const complexStack = new GoalStack("complex-session");

  // Main task
  const mainId = complexStack.push({ type: "task", description: "Migrate database to PostgreSQL" });
  complexStack.activate(mainId);
  console.log("→ Task: Migrate database to PostgreSQL");

  // First obstacle
  const obs1 = complexStack.blockCurrent("PostgreSQL not installed");
  console.log("  🚧 Obstacle: PostgreSQL not installed");

  // Sub-task to fix obstacle
  const subTask = complexStack.push({
    type: "subgoal",
    description: "Install PostgreSQL",
    parentId: mainId,
  });
  complexStack.activate(subTask);
  console.log("    → Subgoal: Install PostgreSQL");

  // Another obstacle!
  const obs2 = complexStack.blockCurrent("Homebrew outdated");
  console.log("      🚧 Obstacle: Homebrew outdated");

  // Fix homebrew
  complexStack.unblock(obs2);
  console.log("      ✅ Fixed: Updated Homebrew");

  // Complete subgoal
  complexStack.complete(subTask);
  console.log("    ✅ Completed: Install PostgreSQL");

  // Unblock main task
  complexStack.unblock(obs1);
  console.log("  ✅ Resolved: PostgreSQL now installed");

  // Complete main task
  complexStack.complete(mainId);
  console.log("✅ Completed: Database migration!");

  console.log("\nGoal history:");
  const all = complexStack.getAll();
  for (const g of all) {
    const indent = g.parentId ? "  " : "";
    const icon = g.status === "completed" ? "✅" : g.status === "blocked" ? "🚧" : "⏳";
    console.log(`${indent}${icon} [${g.type}] ${g.description}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("✅ All interactive tests completed!");
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch(console.error);
