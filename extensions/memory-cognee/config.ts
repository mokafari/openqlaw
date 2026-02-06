import fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CogneeMemoryConfig = {
  llm: {
    provider: "openai" | "anthropic" | "google" | "ollama";
    apiKey: string;
    model?: string;
  };
  dataDir?: string;
  autoCapture?: boolean;
  autoRecall?: boolean;
  vectorStore?: "qdrant" | "lancedb" | "chroma" | "weaviate" | "pinecone";
  graphStore?: "neo4j" | "networkx";
};

const DEFAULT_DATA_DIR = join(homedir(), ".openclaw", "memory", "cognee");

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
  }
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

export const cogneeConfigSchema = {
  parse(value: unknown): CogneeMemoryConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("cognee memory config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(
      cfg,
      ["llm", "dataDir", "autoCapture", "autoRecall", "vectorStore", "graphStore"],
      "cognee memory config",
    );

    const llm = cfg.llm as Record<string, unknown> | undefined;
    if (!llm || typeof llm.apiKey !== "string") {
      throw new Error("llm.apiKey is required");
    }
    assertAllowedKeys(llm, ["apiKey", "provider", "model"], "llm config");

    const provider = (llm.provider as string) || "openai";
    if (!["openai", "anthropic", "google", "ollama"].includes(provider)) {
      throw new Error(`Unsupported LLM provider: ${provider}`);
    }

    return {
      llm: {
        provider: provider as CogneeMemoryConfig["llm"]["provider"],
        apiKey: resolveEnvVars(llm.apiKey),
        model: typeof llm.model === "string" ? llm.model : undefined,
      },
      dataDir: typeof cfg.dataDir === "string" ? cfg.dataDir : DEFAULT_DATA_DIR,
      autoCapture: cfg.autoCapture !== false,
      autoRecall: cfg.autoRecall !== false,
      vectorStore:
        typeof cfg.vectorStore === "string"
          ? (cfg.vectorStore as CogneeMemoryConfig["vectorStore"])
          : undefined,
      graphStore:
        typeof cfg.graphStore === "string"
          ? (cfg.graphStore as CogneeMemoryConfig["graphStore"])
          : undefined,
    };
  },
  uiHints: {
    "llm.apiKey": {
      label: "LLM API Key",
      sensitive: true,
      placeholder: "sk-proj-... or ${OPENAI_API_KEY}",
      help: "API key for LLM provider (supports env var expansion)",
    },
    "llm.provider": {
      label: "LLM Provider",
      placeholder: "openai",
      help: "LLM provider: openai, anthropic, google, or ollama",
    },
    "llm.model": {
      label: "LLM Model",
      placeholder: "gpt-4o-mini",
      help: "Optional model override (uses provider default if not set)",
    },
    dataDir: {
      label: "Data Directory",
      placeholder: "~/.openclaw/memory/cognee",
      advanced: true,
      help: "Directory where Cognee stores its data",
    },
    vectorStore: {
      label: "Vector Store",
      placeholder: "qdrant",
      advanced: true,
      help: "Vector database backend (qdrant, lancedb, chroma, weaviate, pinecone)",
    },
    graphStore: {
      label: "Graph Store",
      placeholder: "neo4j",
      advanced: true,
      help: "Graph database backend (neo4j or networkx)",
    },
    autoCapture: {
      label: "Auto-Capture",
      help: "Automatically capture important information from conversations",
    },
    autoRecall: {
      label: "Auto-Recall",
      help: "Automatically inject relevant memories into context",
    },
  },
};
