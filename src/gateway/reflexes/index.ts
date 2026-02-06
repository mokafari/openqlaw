/**
 * Reflex Middleware
 *
 * Fast-path processing before LLM dispatch.
 * Inspired by Quake III Arena Bot's reflex layer.
 */

import { checkPriorityReflex } from "./priority-reflex.js";
import { checkSafetyReflex } from "./safety-reflex.js";
import { checkStopReflex } from "./stop-reflex.js";

export type ReflexResult = {
  handled: boolean;
  response?: string;
  action?: "abort" | "time" | "status" | "simple" | "blocked";
  reason?: string;
  severity?: "dangerous" | "suspicious" | "safe";
};

/**
 * Process message through reflex layer
 * Returns null if message should proceed to LLM
 */
export function processReflexes(message: string): ReflexResult | null {
  // Check stop reflex first
  const stopResult = checkStopReflex(message);
  if (stopResult.matched) {
    return {
      handled: true,
      action: "abort",
    };
  }

  // Check safety reflex
  const safetyResult = checkSafetyReflex(message);
  if (safetyResult.blocked) {
    return {
      handled: true,
      action: "blocked",
      reason: safetyResult.reason,
      severity: safetyResult.severity,
    };
  }

  // Check priority reflex
  const priorityResult = checkPriorityReflex(message);
  if (priorityResult.matched) {
    return {
      handled: true,
      response: priorityResult.response,
      action: priorityResult.action,
    };
  }

  // No reflex matched, proceed to LLM
  return null;
}
