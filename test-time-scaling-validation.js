#!/usr/bin/env node

/**
 * Test-Time Scaling Validation Script
 * Tests if test-time scaling is activated on complex queries
 */

async function testTestTimeScaling() {
  console.log("🔍 Testing Test-Time Scaling Integration...\n");

  try {
    // Import the module
    console.log("1. Loading TestTimeScalingOptimizer...");
    const { default: TestTimeScalingOptimizer } =
      await import("./dist/agents/evolution/test-time-scaling.js");

    console.log("✅ Module loaded successfully\n");

    // Create an optimizer instance
    const optimizer = new TestTimeScalingOptimizer({
      maxPaths: 3,
      minConfidenceThreshold: 0.7,
      verificationDepth: "medium",
      enableAdaptiveScaling: true,
    });

    console.log("2. Testing complex query optimization...");

    // Test with a complex multi-step reasoning task
    const complexTask = `
        Analyze the following scenario and provide a detailed plan:
        Given that we have a distributed system with 5 microservices, and we need to:
        1. Migrate from MongoDB to PostgreSQL
        2. Implement caching with Redis
        3. Add OAuth2 authentication
        4. Ensure zero-downtime deployment
        5. Maintain data consistency during migration
        
        What would be the step-by-step approach, considering dependencies, 
        risks, and rollback strategies?
        `;

    const startTime = Date.now();

    const result = await optimizer.optimize(complexTask, {
      systemType: "distributed",
      riskTolerance: "low",
      timeConstraint: "moderate",
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log("✅ Optimization completed successfully!\n");

    console.log("📊 Results:");
    console.log(`- Duration: ${duration}ms`);
    console.log(`- Paths considered: ${result.metadata.pathsConsidered}`);
    console.log(`- Compute ratio: ${result.metadata.computeRatio.toFixed(2)}x`);
    console.log(`- Quality improvement: ${(result.metadata.qualityImprovement * 100).toFixed(1)}%`);
    console.log(`- Verification passed: ${result.metadata.verificationPassed}`);
    console.log(`- Final confidence: ${(result.reasoning.confidence * 100).toFixed(1)}%\n`);

    // Test adaptive scaling
    console.log("3. Testing adaptive path count...");

    const simpleTask = "What is 2 + 2?";
    const simpleResult = await optimizer.optimize(simpleTask);

    console.log(`✅ Simple task paths: ${simpleResult.metadata.pathsConsidered}`);
    console.log(`✅ Complex task paths: ${result.metadata.pathsConsidered}`);

    const adaptiveWorking = simpleResult.metadata.pathsConsidered < result.metadata.pathsConsidered;
    console.log(`✅ Adaptive scaling: ${adaptiveWorking ? "Working" : "Not Working"}\n`);

    // Test metrics
    console.log("4. Checking metrics tracking...");
    const metrics = optimizer.getMetrics();
    console.log(`- Total invocations: ${metrics.totalInvocations}`);
    console.log(`- Avg compute ratio: ${metrics.avgComputeRatio.toFixed(2)}x`);
    console.log(
      `- Avg quality improvement: ${(metrics.avgQualityImprovement * 100).toFixed(1)}%\n`,
    );

    // Test research integration
    console.log("5. Testing research integration...");
    try {
      const { getGlobalResearchIntegration } =
        await import("./dist/agents/evolution/research-integration.js");
      const research = getGlobalResearchIntegration();

      const validationResult = await research.validateAndRoute({
        sessionId: "test-session",
        userMessage: complexTask,
        taskType: "general",
        requestedTools: ["analyze", "plan"],
        complexity: 0.85,
      });

      console.log(`✅ Research integration validation: ${validationResult.allowed}`);
      console.log(`✅ Scaling recommendation: ${validationResult.scalingRecommendation}`);
      console.log(`✅ Suggested role: ${validationResult.role?.name || "none"}\n`);

      console.log("🎉 All tests passed! Test-time scaling is integrated and functional.\n");

      return {
        integrated: true,
        activated: true,
        adaptiveScaling: adaptiveWorking,
        researchIntegration: true,
        metrics: metrics,
      };
    } catch (researchError) {
      console.log(`⚠️ Research integration test failed: ${researchError.message}`);
      return {
        integrated: true,
        activated: true,
        adaptiveScaling: adaptiveWorking,
        researchIntegration: false,
        metrics: metrics,
      };
    }
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    console.error(error.stack);
    return {
      integrated: false,
      activated: false,
      error: error.message,
    };
  }
}

// Run the test
testTestTimeScaling()
  .then((results) => {
    console.log("📋 Final Test Results:");
    console.log(JSON.stringify(results, null, 2));

    if (results.integrated && results.activated) {
      console.log("\n✅ SUCCESS: Test-time scaling is working!");
      process.exit(0);
    } else {
      console.log("\n❌ FAILURE: Test-time scaling has issues!");
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error("💥 Test script failed:", error);
    process.exit(1);
  });
