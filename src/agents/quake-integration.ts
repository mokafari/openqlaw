/**
 * Quake Bot Integration Helper
 *
 * Initializes and manages all Quake-inspired components:
 * - FSM State Manager
 * - Goal Stack
 * - Camping Manager
 * - SOUL.md Loader
 * - Synonym Dictionary
 */

import type { SoulPersonality } from "./personality/soul-loader.js";
import type { SynonymDictionary } from "./personality/synonyms.js";
import { loadConfig } from "../config/config.js";
import { loadSessionStore, resolveStorePath, updateSessionStore } from "../config/sessions.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { globalCampingManager } from "./camping.js";
import { loadCampingState, saveCampingState } from "./camping.store.js";
import { createFSMStateManager } from "./fsm/state-manager.js";
import { GoalStack } from "./goals/stack.js";
import { loadSoul } from "./personality/soul-loader.js";
import { resolveInternalSessionKey, resolveMainSessionAlias } from "./tools/sessions-helpers.js";

export type QuakeIntegrationContext = {
  sessionId: string;
  sessionDir: string;
  workspaceDir: string;
  fsmManager: ReturnType<typeof createFSMStateManager>;
  goalStack: GoalStack;
  soul: SoulPersonality | null;
  synonymDictionary: SynonymDictionary;
  /** Tensor intuition layer (initialised when tensor config is enabled). */
  patternStore?: import("./tensor/pattern-store.js").PatternStore;
  tensorRouter?: import("./tensor/router.js").TensorRouter;
  loopController?: import("./tensor/loop-controller.js").NeuroSymbolicLoopController;
  /** Episodic knowledge graph memory (initialised when episodic config is enabled). */
  episodeStore?: import("./episodic/episode-store.js").EpisodeStore;
  knowledgeGraph?: import("./episodic/knowledge-graph.js").KnowledgeGraph;
  /** Embedding provider shared by tensor + episodic (initialised when either is enabled). */
  embeddingProvider?: import("../memory/embeddings.js").EmbeddingProvider;
};

/**
 * Initialize Quake bot integration components
 */
export async function initializeQuakeIntegration(params: {
  sessionId: string;
  sessionDir: string;
  workspaceDir: string;
}): Promise<QuakeIntegrationContext> {
  const { sessionId, sessionDir, workspaceDir } = params;

  // Initialize FSM State Manager
  const fsmManager = createFSMStateManager({
    sessionId,
    sessionDir,
  });
  await fsmManager.load(); // Try to load persisted state

  // Initialize Goal Stack (use existing session-based system)
  let goalStack: GoalStack;
  try {
    const cfg = loadConfig();
    const { alias, mainKey } = resolveMainSessionAlias(cfg);
    const internalKey = resolveInternalSessionKey({
      key: params.sessionId,
      alias,
      mainKey,
    });
    const agentId = resolveAgentIdFromSessionKey(params.sessionId);
    const storePath = resolveStorePath(undefined, { agentId });
    const sessionStore = loadSessionStore(storePath);
    const sessionEntry = sessionStore[internalKey];

    if (sessionEntry?.goalStack?.goals) {
      goalStack = GoalStack.deserialize({
        sessionKey: internalKey,
        goals: sessionEntry.goalStack.goals,
      });
    } else {
      goalStack = new GoalStack(internalKey);
    }
  } catch {
    // Fallback to new stack if session system unavailable
    goalStack = new GoalStack(params.sessionId);
  }

  // Load SOUL.md if present
  const soul = await loadSoul(workspaceDir);

  // Get synonym dictionary (from SOUL.md or default)
  const { DEFAULT_SYNONYMS } = await import("./personality/synonyms.js");
  const synonymDictionary = soul?.synonyms ?? DEFAULT_SYNONYMS;

  // Load camping state if exists
  const campingState = await loadCampingState(sessionDir, sessionId);
  if (campingState) {
    // Restore camping state from persisted data
    globalCampingManager.restoreCamping(campingState);
  }

  // Initialize tensor intuition layer if enabled
  let patternStore: import("./tensor/pattern-store.js").PatternStore | undefined;
  let tensorRouter: import("./tensor/router.js").TensorRouter | undefined;
  let loopController: import("./tensor/loop-controller.js").NeuroSymbolicLoopController | undefined;
  let sharedEmbeddingProvider: import("../memory/embeddings.js").EmbeddingProvider | undefined;
  try {
    const cfg = loadConfig();
    const tensorCfg = cfg.tools?.evolution?.tensor;
    if (tensorCfg?.enabled) {
      const { PatternStore: PatternStoreCls } = await import("./tensor/pattern-store.js");
      const { DEFAULT_TENSOR_CONFIG } = await import("./tensor/types.js");
      const { TensorRouter } = await import("./tensor/router.js");
      const { NeuroSymbolicLoopController } = await import("./tensor/loop-controller.js");
      const { createEmbeddingProvider } = await import("../memory/embeddings.js");

      const agentDir = params.sessionDir;
      const dbPath = (await import("node:path")).join(agentDir, "tensor", "patterns.db");
      const resolvedCfg = { ...DEFAULT_TENSOR_CONFIG, ...tensorCfg };

      patternStore = new PatternStoreCls(dbPath, resolvedCfg);
      await patternStore.initVec().catch(() => {
        // sqlite-vec optional — brute-force cosine fallback
      });

      const embResult = await createEmbeddingProvider({
        config: cfg,
        agentDir,
        provider: "auto",
        model: "text-embedding-3-small",
        fallback: "local",
      });
      sharedEmbeddingProvider = embResult.provider;

      tensorRouter = new TensorRouter({
        store: patternStore,
        embeddingProvider: embResult.provider,
        config: resolvedCfg,
      });

      loopController = new NeuroSymbolicLoopController({
        fsmManager,
        goalStack,
        patternStore,
        embeddingProvider: embResult.provider,
        config: resolvedCfg,
        // Episodic stores will be wired after episodic init (below)
      });
    }
  } catch {
    // Tensor init is non-fatal
  }

  // Initialize episodic knowledge graph memory if enabled
  let episodeStore: import("./episodic/episode-store.js").EpisodeStore | undefined;
  let knowledgeGraph: import("./episodic/knowledge-graph.js").KnowledgeGraph | undefined;
  try {
    const cfg = loadConfig();
    const episodicCfg = cfg.tools?.evolution?.episodic;
    if (episodicCfg?.enabled) {
      const { EpisodeStore: EpisodeStoreCls } = await import("./episodic/episode-store.js");
      const { KnowledgeGraph: KnowledgeGraphCls } = await import("./episodic/knowledge-graph.js");
      const { DEFAULT_EPISODIC_CONFIG } = await import("./episodic/types.js");
      const nodePath = await import("node:path");
      const { DatabaseSync: DbSync } = await import("node:sqlite");

      const agentDir = params.sessionDir;
      const dbPath = nodePath.join(agentDir, "episodic", "memory.db");
      const resolvedCfg = { ...DEFAULT_EPISODIC_CONFIG, ...episodicCfg };

      episodeStore = new EpisodeStoreCls(dbPath, resolvedCfg);
      await episodeStore.initVec().catch(() => {
        // sqlite-vec optional — brute-force cosine fallback
      });

      // KnowledgeGraph shares the same DB file (WAL handles concurrent access)
      const graphDb = new DbSync(dbPath);
      graphDb.exec("PRAGMA journal_mode=WAL");
      graphDb.exec("PRAGMA busy_timeout=5000");
      knowledgeGraph = new KnowledgeGraphCls(graphDb, resolvedCfg);

      // Ensure embedding provider is available for episodic recording
      if (!sharedEmbeddingProvider) {
        const { createEmbeddingProvider } = await import("../memory/embeddings.js");
        const embResult = await createEmbeddingProvider({
          config: cfg,
          agentDir,
          provider: "auto",
          model: "text-embedding-3-small",
          fallback: "local",
        });
        sharedEmbeddingProvider = embResult.provider;
      }
    }
  } catch {
    // Episodic init is non-fatal
  }

  // Wire episodic stores into loop controller for cross-feed recording
  if (loopController && episodeStore && knowledgeGraph) {
    loopController.setEpisodicStores(episodeStore, knowledgeGraph);
  }

  return {
    sessionId,
    sessionDir,
    workspaceDir,
    fsmManager,
    goalStack,
    soul,
    synonymDictionary,
    patternStore,
    tensorRouter,
    loopController,
    episodeStore,
    knowledgeGraph,
    embeddingProvider: sharedEmbeddingProvider,
  };
}

/**
 * Persist Quake integration state
 */
export async function persistQuakeIntegration(context: QuakeIntegrationContext): Promise<void> {
  const { sessionId, fsmManager, goalStack } = context;

  // Persist FSM state
  await fsmManager.persist();

  // Persist goal stack (via session store system)
  try {
    const cfg = loadConfig();
    const { alias, mainKey } = resolveMainSessionAlias(cfg);
    const internalKey = resolveInternalSessionKey({
      key: sessionId,
      alias,
      mainKey,
    });

    const agentId = resolveAgentIdFromSessionKey(sessionId);
    const storePath = resolveStorePath(undefined, { agentId });
    const sessionStore = loadSessionStore(storePath);
    const sessionEntry = sessionStore[internalKey] ?? {};

    sessionEntry.goalStack = {
      goals: goalStack.serialize().goals,
      updatedAt: Date.now(),
    };

    sessionStore[internalKey] = sessionEntry;
    await updateSessionStore(storePath, (store) => {
      store[internalKey] = sessionEntry;
    });
  } catch {
    // Persistence failure is non-fatal
  }

  // Persist camping state
  const campingState = globalCampingManager.getCamping(context.sessionId);
  await saveCampingState(campingState ?? null, context.sessionDir, sessionId);
}

/**
 * Cleanup Quake integration (on session end)
 */
export async function cleanupQuakeIntegration(context: QuakeIntegrationContext): Promise<void> {
  // Exit camping if active
  globalCampingManager.exitCamping(context.sessionId);

  // Final persistence
  await persistQuakeIntegration(context);
}
