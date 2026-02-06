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

  return {
    sessionId,
    sessionDir,
    workspaceDir,
    fsmManager,
    goalStack,
    soul,
    synonymDictionary,
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
