/**
 * Semantic Memory Integration Test
 *
 * Tests the complete semantic memory pipeline:
 * 1. Extract facts from sample episodes
 * 2. Store and retrieve facts
 * 3. Test concept clustering
 * 4. Verify confidence scores
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SemanticFact, ConceptCluster } from "./semantic-types.js";
import type { Episode } from "./types.js";
import { SemanticExtractor } from "./semantic-extractor.js";
import { SemanticStore } from "./semantic-store.js";

/**
 * Generate sample episodes for testing
 */
function generateSampleEpisodes(): Episode[] {
  const baseTime = Date.now() - 86400000; // 1 day ago
  return [
    {
      id: "ep1",
      sessionId: "session1",
      summary:
        "Used read tool with file_path parameter to access user configuration. Operation succeeded.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "executing",
      contextDepth: 2 as const,
      goals: ["read configuration", "setup user"],
      toolsUsed: ["read"],
      outcome: "success",
      fitness: 0.9,
      durationMs: 1500,
      tokenUsage: 250,
      createdAt: baseTime - 0, // 1 day ago
    },
    {
      id: "ep2",
      sessionId: "session1",
      summary: "Attempted to use read tool without file_path parameter. Got ENOENT error.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "executing",
      contextDepth: 2 as const,
      goals: ["read configuration"],
      toolsUsed: ["read"],
      outcome: "failure",
      fitness: 0.1,
      durationMs: 800,
      tokenUsage: 150,
      createdAt: Date.now() - 82800000, // 23 hours ago
    },
    {
      id: "ep3",
      sessionId: "session2",
      summary:
        "Successfully used read tool with file_path parameter for multiple file operations. High efficiency.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "executing",
      contextDepth: 2 as const,
      goals: ["process files", "analyze data"],
      toolsUsed: ["read"],
      outcome: "success",
      fitness: 0.95,
      durationMs: 1200,
      tokenUsage: 200,
      createdAt: Date.now() - 79200000, // 22 hours ago
    },
    {
      id: "ep4",
      sessionId: "session2",
      summary:
        "Used write tool to create new file, then read tool to verify content. Sequence worked perfectly.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "executing",
      contextDepth: 2 as const,
      goals: ["create and verify file"],
      toolsUsed: ["write", "read"],
      outcome: "success",
      fitness: 0.85,
      durationMs: 2100,
      tokenUsage: 400,
      createdAt: Date.now() - 75600000, // 21 hours ago
    },
    {
      id: "ep5",
      sessionId: "session3",
      summary:
        "Attempted file operation without proper parameters. Permission denied error occurred.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "retreating",
      contextDepth: 2 as const,
      goals: ["file operation"],
      toolsUsed: ["read", "write"],
      outcome: "failure",
      fitness: 0.2,
      durationMs: 3000,
      tokenUsage: 300,
      createdAt: Date.now() - 72000000, // 20 hours ago
    },
    {
      id: "ep6",
      sessionId: "session3",
      summary:
        "Optimized read operations by batching file access. Reduced token usage significantly.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "executing",
      contextDepth: 2 as const,
      goals: ["optimize performance"],
      toolsUsed: ["read"],
      outcome: "success",
      fitness: 0.92,
      durationMs: 900,
      tokenUsage: 120,
      createdAt: Date.now() - 68400000, // 19 hours ago
    },
    {
      id: "ep7",
      sessionId: "session4",
      summary: "Used exec tool to run shell commands, then read tool to verify output files.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "executing",
      contextDepth: 3 as const,
      goals: ["run command", "verify output"],
      toolsUsed: ["exec", "read"],
      outcome: "success",
      fitness: 0.8,
      durationMs: 5000,
      tokenUsage: 500,
      createdAt: Date.now() - 64800000, // 18 hours ago
    },
    {
      id: "ep8",
      sessionId: "session4",
      summary:
        "Network timeout error when attempting remote file access. Connection failed after 30s.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "retreating",
      contextDepth: 2 as const,
      goals: ["remote file access"],
      toolsUsed: ["read"],
      outcome: "failure",
      fitness: 0.15,
      durationMs: 30000,
      tokenUsage: 100,
      createdAt: baseTime - 7 * 3600000, // 17 hours ago
    },
    {
      id: "ep9",
      sessionId: "session5",
      summary:
        "Successfully read multiple files using file_path parameter in batch operation. High efficiency achieved.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "executing",
      contextDepth: 2 as const,
      goals: ["batch read files"],
      toolsUsed: ["read"],
      outcome: "success",
      fitness: 0.95,
      durationMs: 2000,
      tokenUsage: 300,
      createdAt: baseTime - 8 * 3600000,
    },
    {
      id: "ep10",
      sessionId: "session5",
      summary:
        "Read tool succeeded with file_path parameter for configuration files. Quick response time.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "executing",
      contextDepth: 2 as const,
      goals: ["read config files"],
      toolsUsed: ["read"],
      outcome: "success",
      fitness: 0.88,
      durationMs: 1200,
      tokenUsage: 180,
      createdAt: baseTime - 9 * 3600000,
    },
    {
      id: "ep11",
      sessionId: "session6",
      summary:
        "Used read tool with file_path to analyze log files. Successful data extraction completed.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "executing",
      contextDepth: 2 as const,
      goals: ["analyze logs"],
      toolsUsed: ["read"],
      outcome: "success",
      fitness: 0.87,
      durationMs: 1800,
      tokenUsage: 320,
      createdAt: baseTime - 10 * 3600000,
    },
    {
      id: "ep12",
      sessionId: "session6",
      summary:
        "Read operation failed due to missing file_path parameter. Error: ENOENT file not found.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "retreating",
      contextDepth: 2 as const,
      goals: ["read file"],
      toolsUsed: ["read"],
      outcome: "failure",
      fitness: 0.1,
      durationMs: 500,
      tokenUsage: 80,
      createdAt: baseTime - 11 * 3600000,
    },
    {
      id: "ep13",
      sessionId: "session7",
      summary:
        "Write tool created file successfully, then read tool verified content using file_path parameter.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "executing",
      contextDepth: 2 as const,
      goals: ["create and verify"],
      toolsUsed: ["write", "read"],
      outcome: "success",
      fitness: 0.89,
      durationMs: 2500,
      tokenUsage: 450,
      createdAt: baseTime - 12 * 3600000,
    },
    {
      id: "ep14",
      sessionId: "session7",
      summary:
        "Optimized file reading by using efficient file_path parameter. Reduced token consumption significantly.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "executing",
      contextDepth: 2 as const,
      goals: ["optimize reading"],
      toolsUsed: ["read"],
      outcome: "success",
      fitness: 0.93,
      durationMs: 800,
      tokenUsage: 120,
      createdAt: baseTime - 13 * 3600000,
    },
    {
      id: "ep15",
      sessionId: "session8",
      summary:
        "Write tool followed by read tool sequence worked perfectly for data processing pipeline.",
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
      fsmState: "executing",
      contextDepth: 2 as const,
      goals: ["data pipeline"],
      toolsUsed: ["write", "read"],
      outcome: "success",
      fitness: 0.91,
      durationMs: 3200,
      tokenUsage: 520,
      createdAt: baseTime - 14 * 3600000,
    },
  ];
}

/**
 * Mock embedding provider for testing
 */
class MockEmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    // Generate deterministic embeddings based on text content
    const hash = this.simpleHash(text);
    return Array(1536)
      .fill(0)
      .map((_, i) => Math.sin(hash + i) * 0.1);
  }

  private simpleHash(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }
}

/**
 * Run the complete integration test
 */
export async function runSemanticIntegrationTest(): Promise<{
  success: boolean;
  results: {
    factsExtracted: SemanticFact[];
    conceptsIdentified: ConceptCluster[];
    stats: any;
    queryTests: any[];
    errors: string[];
  };
}> {
  const errors: string[] = [];
  const results = {
    factsExtracted: [] as SemanticFact[],
    conceptsIdentified: [] as ConceptCluster[],
    stats: {},
    queryTests: [] as any[],
    errors,
  };

  try {
    console.log("🧠 Starting Semantic Memory Integration Test...");

    // Step 1: Generate sample episodes
    const episodes = generateSampleEpisodes();
    console.log(`📊 Generated ${episodes.length} sample episodes`);

    // Step 2: Initialize extractor and extract facts
    const extractor = new SemanticExtractor();
    const mockEmbedding = new MockEmbeddingProvider();

    console.log("🔍 Extracting semantic facts from episodes...");
    const extractionResult = await extractor.extractFacts(episodes, mockEmbedding);

    results.factsExtracted = extractionResult.facts;
    results.conceptsIdentified = extractionResult.concepts;
    results.stats = extractionResult.stats;

    console.log(`✅ Extracted ${extractionResult.facts.length} facts`);
    console.log(`✅ Identified ${extractionResult.concepts.length} concepts`);
    console.log(`📈 Average confidence: ${extractionResult.stats.avgConfidence.toFixed(3)}`);

    // Step 3: Test semantic store
    const tempDbPath = path.join("/tmp", `semantic-test-${Date.now()}.db`);
    const store = new SemanticStore(tempDbPath);
    await store.initVec();

    console.log("💾 Testing semantic store operations...");

    // Store facts and concepts
    extractionResult.facts.forEach((fact) => store.storeFact(fact));
    extractionResult.concepts.forEach((concept) => store.storeConcept(concept));

    // Test queries
    const queryTests = [
      {
        name: "Tool behavior query",
        query: "read tool parameter usage",
        expectedFactTypes: ["tool-behavior", "constraint"],
      },
      {
        name: "Error pattern query",
        query: "file access errors",
        expectedFactTypes: ["error-pattern"],
      },
      {
        name: "Performance optimization query",
        query: "optimization token usage",
        expectedFactTypes: ["pattern", "lesson"],
      },
      {
        name: "Tool sequence query",
        query: "write then read operations",
        expectedFactTypes: ["strategy"],
      },
    ];

    for (const test of queryTests) {
      console.log(`🔍 Testing query: "${test.query}"`);

      const queryResults = await store.queryFacts(test.query, {
        limit: 10,
        embeddingProvider: mockEmbedding,
      });

      const testResult = {
        query: test.query,
        resultsCount: queryResults.length,
        factTypes: queryResults.map((r) => r.fact.type),
        avgConfidence:
          queryResults.length > 0
            ? queryResults.reduce((sum, r) => sum + r.fact.confidence, 0) / queryResults.length
            : 0,
        avgRelevance:
          queryResults.length > 0
            ? queryResults.reduce((sum, r) => sum + r.relevance, 0) / queryResults.length
            : 0,
        passed: queryResults.length > 0,
      };

      results.queryTests.push(testResult);

      if (testResult.passed) {
        console.log(`  ✅ Found ${testResult.resultsCount} relevant facts`);
        console.log(`  📊 Avg confidence: ${testResult.avgConfidence.toFixed(3)}`);
        console.log(`  🎯 Avg relevance: ${testResult.avgRelevance.toFixed(3)}`);
      } else {
        console.log(`  ❌ No results found`);
        errors.push(`Query "${test.query}" returned no results`);
      }
    }

    // Step 4: Test concept clustering
    console.log("🕷️ Testing concept relationships...");
    const concepts = store.getAllConcepts();

    concepts.forEach((concept) => {
      console.log(`  📂 Concept: ${concept.name}`);
      console.log(`    Facts: ${concept.factIds.length}`);
      console.log(`    Related: ${concept.relationships.relatedTo.join(", ")}`);
    });

    // Step 5: Test store statistics
    const storeStats = store.getStats();
    console.log("📊 Store Statistics:");
    console.log(`  Total Facts: ${storeStats.totalFacts}`);
    console.log(`  Total Concepts: ${storeStats.totalConcepts}`);
    console.log(`  Avg Confidence: ${storeStats.avgConfidence.toFixed(3)}`);
    console.log(`  Fact Types: ${JSON.stringify(storeStats.typeDistribution)}`);
    console.log(`  Concepts: ${JSON.stringify(storeStats.conceptDistribution)}`);

    // Cleanup
    store.close();

    const success =
      errors.length === 0 &&
      extractionResult.facts.length > 0 &&
      extractionResult.concepts.length > 0 &&
      results.queryTests.some((t) => t.passed);

    if (success) {
      console.log("🎉 Semantic Memory Integration Test PASSED!");
    } else {
      console.log("❌ Semantic Memory Integration Test FAILED");
      console.log("Errors:", errors);
    }

    return { success, results };
  } catch (error) {
    console.error("💥 Integration test failed with error:", error);
    errors.push(`Test execution failed: ${error instanceof Error ? error.message : String(error)}`);
    return { success: false, results };
  }
}

/**
 * Generate a detailed report of semantic facts
 */
export function generateSemanticReport(facts: SemanticFact[], concepts: ConceptCluster[]): string {
  let report = "# Semantic Memory Analysis Report\n\n";

  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Total Facts:** ${facts.length}\n`;
  report += `**Total Concepts:** ${concepts.length}\n\n`;

  // Facts by type
  const factsByType = facts.reduce(
    (acc, fact) => {
      acc[fact.type] = (acc[fact.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  report += "## Fact Distribution by Type\n\n";
  Object.entries(factsByType).forEach(([type, count]) => {
    report += `- **${type}**: ${count} facts\n`;
  });

  // Top concepts
  report += "\n## Top Concepts\n\n";
  concepts
    .sort((a, b) => b.factIds.length - a.factIds.length)
    .slice(0, 10)
    .forEach((concept) => {
      report += `- **${concept.name}**: ${concept.factIds.length} facts\n`;
      if (concept.relationships.relatedTo.length > 0) {
        report += `  - Related: ${concept.relationships.relatedTo.slice(0, 3).join(", ")}\n`;
      }
    });

  // High-confidence facts
  report += "\n## High-Confidence Facts (>0.8)\n\n";
  facts
    .filter((f) => f.confidence > 0.8)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10)
    .forEach((fact) => {
      report += `- **${fact.statement}** (${(fact.confidence * 100).toFixed(1)}%)\n`;
      report += `  - Type: ${fact.type}, Evidence: ${fact.evidenceCount}\n`;
    });

  // Tool-related insights
  const toolFacts = facts.filter((f) => f.concept.includes("tool") || f.type === "tool-behavior");
  if (toolFacts.length > 0) {
    report += "\n## Tool Usage Insights\n\n";
    toolFacts.slice(0, 5).forEach((fact) => {
      report += `- ${fact.statement}\n`;
    });
  }

  return report;
}

// Export for use in CLI/testing
if (import.meta.url === `file://${process.argv[1]}`) {
  runSemanticIntegrationTest()
    .then(({ success, results }) => {
      if (success) {
        const report = generateSemanticReport(results.factsExtracted, results.conceptsIdentified);
        writeFileSync("/tmp/semantic-memory-report.md", report);
        console.log("📄 Report saved to /tmp/semantic-memory-report.md");
      }
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Test execution failed:", error);
      process.exit(1);
    });
}
