/**
 * Semantic Fact Extractor
 *
 * Analyzes episodes to extract generalized semantic facts.
 * Detects patterns in tool usage, error handling, and outcomes.
 */

import crypto from "node:crypto";
import type {
  SemanticFact,
  ConceptCluster,
  ExtractionResult,
  FactPattern,
  SemanticConfig,
} from "./semantic-types.js";
import type { Episode } from "./types.js";
import { DEFAULT_SEMANTIC_CONFIG } from "./semantic-types.js";

export class SemanticExtractor {
  private config: SemanticConfig;
  private patterns: FactPattern[] = [];

  constructor(config?: Partial<SemanticConfig>) {
    this.config = { ...DEFAULT_SEMANTIC_CONFIG, ...config };
    this.initializePatterns();
  }

  /**
   * Extract semantic facts from a batch of episodes
   */
  async extractFacts(
    episodes: Episode[],
    embeddingProvider?: { embed: (text: string) => Promise<number[]> },
  ): Promise<ExtractionResult> {
    const startTime = Date.now();
    let allCandidateFacts: SemanticFact[] = [];

    // Run pattern extractors
    for (const pattern of this.patterns) {
      try {
        const candidateFacts = pattern.matcher(episodes);
        allCandidateFacts = allCandidateFacts.concat(candidateFacts);
      } catch (error) {
        console.warn(`Pattern ${pattern.name} failed:`, error);
      }
    }

    // Group facts by similar statements and merge evidence
    const consolidatedFacts = this.consolidateFacts(allCandidateFacts);

    // Filter by confidence and evidence thresholds
    const validFacts = consolidatedFacts.filter(
      (fact) =>
        fact.confidence >= this.config.minConfidenceThreshold &&
        fact.evidenceCount >= this.config.minEvidenceCount,
    );

    // Generate embeddings for facts
    if (embeddingProvider) {
      for (const fact of validFacts) {
        try {
          fact.embedding = await embeddingProvider.embed(fact.statement);
        } catch (error) {
          console.warn(`Failed to embed fact: ${fact.statement}`, error);
          fact.embedding = [];
        }
      }
    }

    // Extract concepts and build clusters
    const concepts = this.extractConcepts(validFacts, embeddingProvider);

    const stats = {
      episodesProcessed: episodes.length,
      factsExtracted: validFacts.length,
      conceptsIdentified: concepts.length,
      avgConfidence:
        validFacts.length > 0
          ? validFacts.reduce((sum, f) => sum + f.confidence, 0) / validFacts.length
          : 0,
    };

    return { facts: validFacts, concepts, stats };
  }

  /**
   * Initialize fact extraction patterns
   */
  private initializePatterns(): void {
    this.patterns = [
      this.toolBehaviorPattern(),
      this.errorPattern(),
      this.optimizationPattern(),
      this.parameterPattern(),
      this.sequencePattern(),
      this.outcomePattern(),
    ];
  }

  /**
   * Pattern: Tool behavior and parameter usage
   */
  private toolBehaviorPattern(): FactPattern {
    return {
      name: "tool-behavior",
      description: "Extract tool usage patterns and parameter behaviors",
      matcher: (episodes: Episode[]) => {
        const toolUsage = new Map<string, { success: number; total: number; params: string[] }>();

        episodes.forEach((episode) => {
          episode.toolsUsed.forEach((tool) => {
            if (!toolUsage.has(tool)) {
              toolUsage.set(tool, { success: 0, total: 0, params: [] });
            }

            const usage = toolUsage.get(tool)!;
            usage.total++;
            if (episode.outcome === "success") {
              usage.success++;
            }
          });
        });

        const facts: SemanticFact[] = [];

        toolUsage.forEach((usage, tool) => {
          if (usage.total >= 3) {
            const successRate = usage.success / usage.total;
            const confidence = Math.min(0.95, usage.total / 10); // More data = higher confidence

            facts.push({
              id: this.generateFactId(`tool-behavior-${tool}-success`),
              type: "tool-behavior",
              statement: `${tool} tool succeeds ${(successRate * 100).toFixed(1)}% of the time`,
              confidence,
              evidenceCount: usage.total,
              evidenceEpisodeIds: episodes
                .filter((e) => e.toolsUsed.includes(tool))
                .map((e) => e.id)
                .slice(0, 10),
              concept: `${tool}-tool`,
              subConcepts: ["tool-usage", "success-rates"],
              embedding: [],
              createdAt: Date.now(),
              lastUpdated: Date.now(),
              metadata: { successRate, totalUsage: usage.total },
            });
          }
        });

        return facts;
      },
      conceptExtractor: (fact) => [fact.concept, ...fact.subConcepts],
    };
  }

  /**
   * Pattern: Error patterns and recovery strategies
   */
  private errorPattern(): FactPattern {
    return {
      name: "error-pattern",
      description: "Extract common error patterns and their contexts",
      matcher: (episodes: Episode[]) => {
        const errorPatterns = new Map<string, { count: number; contexts: string[] }>();

        episodes
          .filter((e) => e.outcome === "failure")
          .forEach((episode) => {
            // Look for common error keywords in summaries
            const errorKeywords = this.extractErrorKeywords(episode.summary);
            errorKeywords.forEach((keyword) => {
              if (!errorPatterns.has(keyword)) {
                errorPatterns.set(keyword, { count: 0, contexts: [] });
              }
              const pattern = errorPatterns.get(keyword)!;
              pattern.count++;
              if (pattern.contexts.length < 5) {
                pattern.contexts.push(episode.summary);
              }
            });
          });

        const facts: SemanticFact[] = [];

        errorPatterns.forEach((pattern, keyword) => {
          if (pattern.count >= 3) {
            const confidence = Math.min(0.9, pattern.count / 5);

            facts.push({
              id: this.generateFactId(`error-pattern-${keyword}`),
              type: "error-pattern",
              statement: `${keyword} errors occur commonly (${pattern.count} instances)`,
              confidence,
              evidenceCount: pattern.count,
              evidenceEpisodeIds: episodes
                .filter((e) => e.outcome === "failure" && e.summary.toLowerCase().includes(keyword))
                .map((e) => e.id)
                .slice(0, 10),
              concept: "error-handling",
              subConcepts: [keyword, "failure-patterns"],
              embedding: [],
              createdAt: Date.now(),
              lastUpdated: Date.now(),
              metadata: { errorType: keyword, contexts: pattern.contexts },
            });
          }
        });

        return facts;
      },
      conceptExtractor: (fact) => ["error-handling", fact.metadata?.errorType as string],
    };
  }

  /**
   * Pattern: Optimization and performance patterns
   */
  private optimizationPattern(): FactPattern {
    return {
      name: "optimization",
      description: "Extract performance and efficiency patterns",
      matcher: (episodes: Episode[]) => {
        const facts: SemanticFact[] = [];

        // Group episodes by similar tools and analyze performance
        const toolPerformance = new Map<string, { durations: number[]; tokens: number[] }>();

        episodes.forEach((episode) => {
          const toolKey = episode.toolsUsed.join(",");
          if (!toolPerformance.has(toolKey)) {
            toolPerformance.set(toolKey, { durations: [], tokens: [] });
          }

          const perf = toolPerformance.get(toolKey)!;
          if (episode.durationMs > 0) perf.durations.push(episode.durationMs);
          if (episode.tokenUsage > 0) perf.tokens.push(episode.tokenUsage);
        });

        toolPerformance.forEach((perf, toolKey) => {
          if (perf.durations.length >= 5) {
            const avgDuration = perf.durations.reduce((a, b) => a + b, 0) / perf.durations.length;
            const avgTokens =
              perf.tokens.length > 0
                ? perf.tokens.reduce((a, b) => a + b, 0) / perf.tokens.length
                : 0;

            facts.push({
              id: this.generateFactId(`optimization-${toolKey}`),
              type: "pattern",
              statement: `${toolKey} operations typically take ${(avgDuration / 1000).toFixed(2)}s and ${avgTokens.toFixed(0)} tokens`,
              confidence: Math.min(0.85, perf.durations.length / 10),
              evidenceCount: perf.durations.length,
              evidenceEpisodeIds: episodes
                .filter((e) => e.toolsUsed.join(",") === toolKey)
                .map((e) => e.id)
                .slice(0, 10),
              concept: "performance",
              subConcepts: ["duration", "token-usage", toolKey.split(",")[0]],
              embedding: [],
              createdAt: Date.now(),
              lastUpdated: Date.now(),
              metadata: { avgDuration, avgTokens, toolSequence: toolKey },
            });
          }
        });

        return facts;
      },
      conceptExtractor: (fact) => ["performance", "optimization"],
    };
  }

  /**
   * Pattern: Parameter validation and requirements
   */
  private parameterPattern(): FactPattern {
    return {
      name: "parameter",
      description: "Extract parameter validation patterns",
      matcher: (episodes: Episode[]) => {
        const facts: SemanticFact[] = [];

        // Look for parameter-related patterns in summaries
        episodes.forEach((episode) => {
          const paramMatches = episode.summary.match(
            /(\w+)\s+parameter|file_path|path\s+parameter/gi,
          );
          if (paramMatches && episode.outcome === "success") {
            paramMatches.forEach((match) => {
              const param = match.toLowerCase().replace(/\s+parameter/, "");
              facts.push({
                id: this.generateFactId(`param-${param}-${episode.id}`),
                type: "constraint",
                statement: `${param} parameter works correctly in ${episode.toolsUsed.join(", ")}`,
                confidence: 0.8,
                evidenceCount: 1,
                evidenceEpisodeIds: [episode.id],
                concept: "parameter-validation",
                subConcepts: [param, ...episode.toolsUsed],
                embedding: [],
                createdAt: Date.now(),
                lastUpdated: Date.now(),
                metadata: { parameter: param, tools: episode.toolsUsed },
              });
            });
          }
        });

        return facts;
      },
      conceptExtractor: (fact) => ["parameter-validation", fact.metadata?.parameter as string],
    };
  }

  /**
   * Pattern: Tool sequence patterns
   */
  private sequencePattern(): FactPattern {
    return {
      name: "sequence",
      description: "Extract successful tool sequence patterns",
      matcher: (episodes: Episode[]) => {
        const facts: SemanticFact[] = [];
        const sequences = new Map<string, number>();

        episodes
          .filter((e) => e.outcome === "success" && e.toolsUsed.length > 1)
          .forEach((episode) => {
            const sequence = episode.toolsUsed.join(" → ");
            sequences.set(sequence, (sequences.get(sequence) || 0) + 1);
          });

        sequences.forEach((count, sequence) => {
          if (count >= 3) {
            facts.push({
              id: this.generateFactId(`sequence-${sequence}`),
              type: "strategy",
              statement: `Tool sequence "${sequence}" is successful (used ${count} times)`,
              confidence: Math.min(0.9, count / 5),
              evidenceCount: count,
              evidenceEpisodeIds: episodes
                .filter((e) => e.toolsUsed.join(" → ") === sequence)
                .map((e) => e.id)
                .slice(0, 10),
              concept: "tool-sequences",
              subConcepts: sequence.split(" → ").filter((t) => t !== "→"),
              embedding: [],
              createdAt: Date.now(),
              lastUpdated: Date.now(),
              metadata: { sequence: sequence.split(" → "), usageCount: count },
            });
          }
        });

        return facts;
      },
      conceptExtractor: (fact) => [
        "tool-sequences",
        ...((fact.metadata?.sequence as string[]) || []),
      ],
    };
  }

  /**
   * Pattern: Outcome prediction patterns
   */
  private outcomePattern(): FactPattern {
    return {
      name: "outcome",
      description: "Extract patterns that predict success or failure",
      matcher: (episodes: Episode[]) => {
        const facts: SemanticFact[] = [];

        // Find high-fitness episodes and extract their common characteristics
        const highFitnessEpisodes = episodes.filter((e) => e.fitness > 0.8);
        const lowFitnessEpisodes = episodes.filter((e) => e.fitness < 0.3);

        if (highFitnessEpisodes.length >= 3) {
          const commonTools = this.findCommonElements(highFitnessEpisodes.map((e) => e.toolsUsed));
          commonTools.forEach((tool) => {
            facts.push({
              id: this.generateFactId(`outcome-high-fitness-${tool}`),
              type: "lesson",
              statement: `Using ${tool} tool correlates with high fitness scores`,
              confidence: 0.75,
              evidenceCount: highFitnessEpisodes.length,
              evidenceEpisodeIds: highFitnessEpisodes.map((e) => e.id).slice(0, 10),
              concept: "success-patterns",
              subConcepts: [tool, "high-fitness"],
              embedding: [],
              createdAt: Date.now(),
              lastUpdated: Date.now(),
              metadata: {
                avgFitness:
                  highFitnessEpisodes.reduce((a, b) => a + b.fitness, 0) /
                  highFitnessEpisodes.length,
              },
            });
          });
        }

        return facts;
      },
      conceptExtractor: (fact) => ["success-patterns", "fitness-correlation"],
    };
  }

  /**
   * Consolidate similar facts by merging evidence
   */
  private consolidateFacts(facts: SemanticFact[]): SemanticFact[] {
    const consolidated = new Map<string, SemanticFact>();

    facts.forEach((fact) => {
      // Create a key based on statement similarity
      const key = this.normalizeStatement(fact.statement);

      if (consolidated.has(key)) {
        const existing = consolidated.get(key)!;
        // Merge evidence
        existing.evidenceCount += fact.evidenceCount;
        existing.evidenceEpisodeIds = [
          ...new Set([...existing.evidenceEpisodeIds, ...fact.evidenceEpisodeIds]),
        ];
        // Update confidence based on more evidence
        existing.confidence = Math.min(0.95, existing.confidence + fact.confidence * 0.1);
        existing.lastUpdated = Date.now();
      } else {
        consolidated.set(key, { ...fact });
      }
    });

    return Array.from(consolidated.values());
  }

  /**
   * Extract concepts from facts and build concept clusters
   */
  private extractConcepts(
    facts: SemanticFact[],
    embeddingProvider?: { embed: (text: string) => Promise<number[]> },
  ): ConceptCluster[] {
    const conceptMap = new Map<string, { factIds: Set<string>; relatedConcepts: Set<string> }>();

    // Collect all concepts from facts
    facts.forEach((fact) => {
      const allConcepts = [fact.concept, ...fact.subConcepts];
      allConcepts.forEach((concept) => {
        if (!conceptMap.has(concept)) {
          conceptMap.set(concept, { factIds: new Set(), relatedConcepts: new Set() });
        }
        conceptMap.get(concept)!.factIds.add(fact.id);

        // Add other concepts as related
        allConcepts.forEach((otherConcept) => {
          if (otherConcept !== concept) {
            conceptMap.get(concept)!.relatedConcepts.add(otherConcept);
          }
        });
      });
    });

    // Build concept clusters
    const concepts: ConceptCluster[] = [];

    conceptMap.forEach((data, conceptName) => {
      if (data.factIds.size >= 1) {
        // Include concepts with at least one fact
        concepts.push({
          id: this.generateFactId(`concept-${conceptName}`),
          name: conceptName,
          factIds: Array.from(data.factIds),
          relationships: {
            relatedTo: Array.from(data.relatedConcepts),
            causedBy: [], // Could be enhanced with causal analysis
            enabledBy: [], // Could be enhanced with dependency analysis
            contradictedBy: [], // Could be enhanced with contradiction detection
          },
          embedding: [], // Will be populated later if embeddingProvider available
          createdAt: Date.now(),
          lastUpdated: Date.now(),
        });
      }
    });

    return concepts;
  }

  /**
   * Extract error keywords from episode summary
   */
  private extractErrorKeywords(summary: string): string[] {
    const errorPatterns = [
      /error|failed|failure/gi,
      /timeout|timed out/gi,
      /not found|404|enoent/gi,
      /permission denied|403/gi,
      /invalid|validation/gi,
      /connection|network/gi,
      /syntax|parse/gi,
      /missing|undefined|null/gi,
    ];

    const keywords = new Set<string>();

    errorPatterns.forEach((pattern) => {
      const matches = summary.match(pattern);
      if (matches) {
        matches.forEach((match) => keywords.add(match.toLowerCase()));
      }
    });

    return Array.from(keywords);
  }

  /**
   * Find common elements across arrays
   */
  private findCommonElements(arrays: string[][]): string[] {
    if (arrays.length === 0) return [];

    const counts = new Map<string, number>();
    const threshold = Math.ceil(arrays.length * 0.6); // Element must appear in 60% of arrays

    arrays.forEach((arr) => {
      const unique = new Set(arr);
      unique.forEach((item) => {
        counts.set(item, (counts.get(item) || 0) + 1);
      });
    });

    return Array.from(counts.entries())
      .filter(([_, count]) => count >= threshold)
      .map(([item, _]) => item);
  }

  /**
   * Normalize statement for similarity comparison
   */
  private normalizeStatement(statement: string): string {
    return statement
      .toLowerCase()
      .replace(/\d+(\.\d+)?%/g, "X%") // Replace percentages
      .replace(/\d+(\.\d+)?s/g, "Xs") // Replace time durations
      .replace(/\d+/g, "N") // Replace numbers
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Generate a deterministic fact ID
   */
  private generateFactId(seed: string): string {
    return crypto.createHash("md5").update(seed).digest("hex").substring(0, 16);
  }
}
