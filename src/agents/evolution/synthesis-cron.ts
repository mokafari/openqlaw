/**
 * Knowledge Synthesis Cron Job
 *
 * Runs daily to synthesize knowledge from telemetry, journal entries, and patterns.
 */

import { log } from "../pi-embedded-runner/logger.js";
import { KnowledgeSynthesis } from "./knowledge-synthesis.js";

export async function runKnowledgeSynthesisCron(): Promise<void> {
  log.info("[synthesis-cron] Starting knowledge synthesis...");

  try {
    const synthesis = new KnowledgeSynthesis();
    const today = new Date().toISOString().split("T")[0];
    await synthesis.synthesizeDaily(today);

    log.info("[synthesis-cron] Knowledge synthesis completed");
  } catch (err) {
    log.error(
      `[synthesis-cron] Synthesis failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
