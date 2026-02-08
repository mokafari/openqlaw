/**
 * Semantic Query Tool
 *
 * Direct access to semantic memory for concept lookup and fact retrieval.
 * Complements episodic recall with generalized knowledge queries.
 */

import { Type } from "@sinclair/typebox";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, readStringArrayParam, readNumberParam } from "./common.js";

const SemanticQuerySchema = Type.Object({
  query: Type.String(),
  concepts: Type.Optional(Type.Array(Type.String())),
  types: Type.Optional(Type.Array(Type.String())),
  limit: Type.Optional(Type.Number()),
  minConfidence: Type.Optional(Type.Number()),
});

export function createSemanticQueryTool(options: {
  config?: OpenClawConfig;
  agentDir?: string;
}): AnyAgentTool | null {
  const episodicCfg = options.config?.tools?.evolution?.episodic;
  if (!episodicCfg?.enabled) {
    return null;
  }
  if (!options.agentDir?.trim()) {
    return null;
  }

  return {
    label: "Semantic Memory",
    name: "semantic_query",
    description:
      "Search semantic memory for generalized knowledge, facts, and patterns. " +
      "Returns high-level insights extracted from past experiences rather than specific episodes. " +
      "Use for concept lookup, strategy patterns, tool behaviors, and learned lessons. " +
      "Supports filtering by concept, fact type, and confidence level.",
    parameters: SemanticQuerySchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(params, "query", { required: true });
      const concepts = readStringArrayParam(params, "concepts");
      const types = readStringArrayParam(params, "types");
      const limit = readNumberParam(params, "limit") ?? 10;
      const minConfidence = readNumberParam(params, "minConfidence");

      try {
        // Lazy imports
        const { SemanticStore } = await import("../episodic/semantic-store.js");
        const { createEmbeddingProvider } = await import("../../memory/embeddings.js");
        const { DEFAULT_SEMANTIC_CONFIG } = await import("../episodic/semantic-types.js");
        const { loadConfig } = await import("../../config/config.js");

        const cfg = options.config ?? loadConfig();
        const resolvedCfg = { ...DEFAULT_SEMANTIC_CONFIG, ...episodicCfg };

        const dbPath = path.join(options.agentDir!, "episodic", "semantic.db");
        const store = new SemanticStore(dbPath, resolvedCfg);
        await store.initVec().catch(() => {});

        // Create embedding provider for vector search
        let embeddingProvider;
        try {
          const embResult = await createEmbeddingProvider({
            config: cfg,
            agentDir: options.agentDir,
            provider: "local",
            model: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf",
            fallback: "none",
          });
          embeddingProvider = embResult.provider;
        } catch {
          // Proceed without embeddings if not available
        }

        // Query semantic facts
        const results = await store.queryFacts(query, {
          limit,
          concepts: concepts as string[],
          types: types as string[],
          minConfidence,
          embeddingProvider,
        });

        // Close store
        store.close();

        // Format results for output
        const formatted = results.map((r) => ({
          statement: r.fact.statement,
          type: r.fact.type,
          concept: r.fact.concept,
          subConcepts: r.fact.subConcepts,
          confidence: Number(r.fact.confidence.toFixed(3)),
          evidenceCount: r.fact.evidenceCount,
          relevance: Number(r.relevance.toFixed(3)),
          explanation: r.explanation,
          age: formatAge(r.fact.createdAt),
          metadata: r.fact.metadata,
        }));

        // Get related concepts for context
        const relatedConcepts = await getRelatedConcepts(store, (concepts as string[]) || []);

        return jsonResult({
          facts: formatted,
          totalFacts: results.length,
          relatedConcepts,
          query: {
            originalQuery: query,
            conceptFilter: concepts,
            typeFilter: types,
            minConfidenceFilter: minConfidence,
          },
        });
      } catch (err) {
        return jsonResult({
          error: `Semantic query failed: ${err instanceof Error ? err.message : String(err)}`,
          facts: [],
        });
      }
    },
  };
}

async function getRelatedConcepts(store: any, queryConcepts: string[]): Promise<string[]> {
  try {
    if (queryConcepts.length === 0) return [];

    const allConcepts = store.getAllConcepts();
    const related = new Set<string>();

    queryConcepts.forEach((queryConceptName) => {
      const concept = allConcepts.find((c: any) => c.name === queryConceptName);
      if (concept) {
        concept.relationships.relatedTo.forEach((relatedName: string) => {
          related.add(relatedName);
        });
      }
    });

    return Array.from(related).slice(0, 5); // Limit to top 5 related concepts
  } catch {
    return [];
  }
}

function formatAge(createdAt: number): string {
  const ageMs = Date.now() - createdAt;
  const hours = Math.floor(ageMs / (1000 * 60 * 60));
  if (hours < 1) {
    return "< 1 hour ago";
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
