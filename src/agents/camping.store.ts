/**
 * Camping State Persistence
 *
 * Persists camping state to session directory for crash recovery.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { CampingState } from "./camping.js";

/**
 * Load camping state from session directory
 */
export async function loadCampingState(
  sessionDir: string,
  sessionId: string,
): Promise<CampingState | null> {
  const campingFile = path.join(sessionDir, `${sessionId}_camping.json`);

  try {
    const content = await fs.readFile(campingFile, "utf-8");
    const state = JSON.parse(content) as CampingState;

    // Validate state
    if (state.sessionId && state.waitingFor && state.triggerId) {
      return state;
    }
  } catch (error) {
    // File doesn't exist or invalid - no camping state
    if ((error as { code?: string }).code !== "ENOENT") {
      console.warn(`Failed to load camping state: ${String(error)}`);
    }
  }

  return null;
}

/**
 * Save camping state to session directory
 */
export async function saveCampingState(
  state: CampingState | null,
  sessionDir: string,
  sessionId: string,
): Promise<void> {
  const campingFile = path.join(sessionDir, `${sessionId}_camping.json`);

  try {
    await fs.mkdir(sessionDir, { recursive: true });

    if (state) {
      await fs.writeFile(campingFile, JSON.stringify(state, null, 2), "utf-8");
    } else {
      // Delete file if no camping state
      try {
        await fs.unlink(campingFile);
      } catch {
        // File doesn't exist - that's fine
      }
    }
  } catch (error) {
    // Log but don't throw - persistence failures shouldn't break execution
    console.warn(`Failed to save camping state: ${String(error)}`);
  }
}

/**
 * Delete camping state file
 */
export async function deleteCampingState(sessionDir: string, sessionId: string): Promise<void> {
  const campingFile = path.join(sessionDir, `${sessionId}_camping.json`);

  try {
    await fs.unlink(campingFile);
  } catch (error) {
    // File doesn't exist - that's fine
    if ((error as { code?: string }).code !== "ENOENT") {
      console.warn(`Failed to delete camping state: ${String(error)}`);
    }
  }
}
