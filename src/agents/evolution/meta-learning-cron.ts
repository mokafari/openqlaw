/**
 * Meta-Learning Cron Setup
 *
 * Registers daily cron jobs for knowledge synthesis and journal generation.
 */

import { log } from "../pi-embedded-runner/logger.js";
import { runDailyJournalCron } from "./daily-journal.js";
import { runKnowledgeSynthesisCron } from "./synthesis-cron.js";

export type MetaLearningCronHandle = {
  stop: () => void;
};

/**
 * Built-in cron handlers for meta-learning.
 * These can be triggered by the cron system via systemEvent payloads.
 */
export const META_LEARNING_CRON_HANDLERS: Record<string, () => Promise<void>> = {
  "meta-learning:synthesis": runKnowledgeSynthesisCron,
  "meta-learning:daily-journal": runDailyJournalCron,
};

/**
 * Run a meta-learning cron handler by name.
 */
export async function runMetaLearningCronHandler(handlerName: string): Promise<boolean> {
  const handler = META_LEARNING_CRON_HANDLERS[handlerName];
  if (!handler) {
    log.warn(`[meta-learning-cron] Unknown handler: ${handlerName}`);
    return false;
  }

  try {
    await handler();
    return true;
  } catch (err) {
    log.error(
      `[meta-learning-cron] Handler ${handlerName} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Get cron job definitions for meta-learning.
 * These can be passed to the cron system to register the jobs.
 */
export function getMetaLearningCronJobDefinitions(): Array<{
  name: string;
  schedule: { kind: "cron"; expr: string; tz?: string };
  payload: { kind: "systemEvent"; text: string };
  sessionTarget: "main" | "isolated";
  enabled: boolean;
}> {
  return [
    {
      name: "Meta-Learning: Knowledge Synthesis",
      schedule: {
        kind: "cron",
        expr: "0 3 * * *", // 3 AM daily
        tz: "Europe/Stockholm",
      },
      payload: {
        kind: "systemEvent",
        text: "Run meta-learning knowledge synthesis: meta-learning:synthesis",
      },
      sessionTarget: "main",
      enabled: true,
    },
    {
      name: "Meta-Learning: Daily Journal",
      schedule: {
        kind: "cron",
        expr: "0 4 * * *", // 4 AM daily (after synthesis)
        tz: "Europe/Stockholm",
      },
      payload: {
        kind: "systemEvent",
        text: "Run meta-learning daily journal: meta-learning:daily-journal",
      },
      sessionTarget: "main",
      enabled: true,
    },
  ];
}

/**
 * Check if a system event text is a meta-learning cron trigger.
 */
export function isMetaLearningCronTrigger(text: string): string | null {
  const match = text.match(/meta-learning:(synthesis|daily-journal)$/);
  if (match) {
    return `meta-learning:${match[1]}`;
  }
  return null;
}
