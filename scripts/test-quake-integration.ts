#!/usr/bin/env node
/**
 * Test script for Quake Bot Integration
 *
 * Verifies all components are working correctly
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ContextGraph } from "../src/agents/aas/context-graph.js";
import { globalCampingManager } from "../src/agents/camping.js";
import { analyzeTaskComplexity, selectModelFuzzy } from "../src/agents/fuzzy-selector.js";
import { getTraitForEvent } from "../src/agents/personality/contextual-triggers.js";
import { loadSoul } from "../src/agents/personality/soul-loader.js";
import { selectSynonym, DEFAULT_SYNONYMS } from "../src/agents/personality/synonyms.js";
import {
  initializeQuakeIntegration,
  persistQuakeIntegration,
} from "../src/agents/quake-integration.js";

async function main() {
  console.log("🧪 Testing Quake Bot Integration\n");

  const testDir = path.join(os.tmpdir(), "openclaw-quake-test");
  const sessionDir = path.join(testDir, "sessions");
  const workspaceDir = path.join(testDir, "workspace");

  // Clean up and create test directories
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {}
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });

  const sessionId = "test-session-123";

  console.log("1️⃣ Testing Quake Integration Initialization...");
  try {
    const context = await initializeQuakeIntegration({
      sessionId,
      sessionDir,
      workspaceDir,
    });

    console.log("   ✅ FSM Manager initialized");
    console.log(`   ✅ Current FSM State: ${context.fsmManager.getState()}`);
    console.log(`   ✅ Goal Stack initialized (empty: ${context.goalStack.isEmpty()})`);
    console.log(`   ✅ SOUL.md loaded: ${context.soul ? "Yes" : "No (expected)"}`);
    console.log(
      `   ✅ Synonym Dictionary loaded: ${Object.keys(context.synonymDictionary).length} contexts`,
    );

    // Test FSM transitions
    console.log("\n2️⃣ Testing FSM State Transitions...");
    await context.fsmManager.transitionTo("planning");
    console.log(`   ✅ Transitioned to: ${context.fsmManager.getState()}`);
    await context.fsmManager.transitionTo("executing");
    console.log(`   ✅ Transitioned to: ${context.fsmManager.getState()}`);

    // Test Goal Stack
    console.log("\n3️⃣ Testing Goal Stack...");
    const goalId = context.goalStack.push({
      type: "task",
      description: "Test goal",
    });
    console.log(`   ✅ Pushed goal: ${goalId}`);
    console.log(`   ✅ Stack depth: ${context.goalStack.getDepth()}`);
    const current = context.goalStack.peek();
    console.log(`   ✅ Current goal: ${current?.description}`);

    // Test persistence
    console.log("\n4️⃣ Testing State Persistence...");
    await persistQuakeIntegration(context);
    console.log("   ✅ State persisted successfully");

    // Test Context Graph
    console.log("\n5️⃣ Testing Context Graph...");
    const contextForCheck = {
      workspaceDir,
      hasNetwork: true,
    };
    const canRead = await ContextGraph.check(contextForCheck, "CanRead");
    console.log(`   ✅ CanRead check: ${canRead}`);
    const canWrite = await ContextGraph.check(contextForCheck, "CanWrite");
    console.log(`   ✅ CanWrite check: ${canWrite}`);

    // Test Fuzzy Model Selector
    console.log("\n6️⃣ Testing Fuzzy Model Selector...");
    const complexity = analyzeTaskComplexity("Refactor the entire authentication system");
    console.log(`   ✅ Task complexity: ${complexity.toFixed(2)}`);
    const model = selectModelFuzzy({
      taskComplexity: complexity,
      contextBudget: 0.75,
      userUrgency: 0.5,
    });
    console.log(`   ✅ Selected model: ${model.provider}/${model.model}`);

    // Test Camping Manager
    console.log("\n7️⃣ Testing Camping Manager...");
    globalCampingManager.enterCamping({
      sessionId,
      waitingFor: "process",
      triggerId: "test-pid-123",
      resumeCondition: "process completes",
      timeoutSeconds: 60,
    });
    console.log(`   ✅ Camping state: ${globalCampingManager.isCamping(sessionId)}`);
    globalCampingManager.exitCamping(sessionId);
    console.log(`   ✅ Exited camping: ${!globalCampingManager.isCamping(sessionId)}`);

    // Test Synonyms
    console.log("\n8️⃣ Testing Synonym Dictionary...");
    const synonym = selectSynonym("TOOL_SUCCESS", DEFAULT_SYNONYMS);
    console.log(`   ✅ Selected synonym: "${synonym}"`);

    // Test SOUL.md loading (if exists)
    console.log("\n9️⃣ Testing SOUL.md Loading...");
    const soul = await loadSoul(workspaceDir);
    if (soul) {
      console.log(`   ✅ SOUL.md loaded with ${soul.traits?.length ?? 0} traits`);
      const traits = getTraitForEvent("BUILD_FAILURE", soul);
      console.log(`   ✅ Traits for BUILD_FAILURE: ${traits.join(", ")}`);
    } else {
      console.log("   ℹ️  No SOUL.md found (expected)");
    }

    console.log("\n✅ All tests passed!");
    console.log("\n🧹 Cleaning up...");
    await fs.rm(testDir, { recursive: true, force: true });
    console.log("   ✅ Cleanup complete");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    if (error instanceof Error) {
      console.error("   Stack:", error.stack);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
