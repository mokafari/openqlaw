/**
 * Stop Reflex
 *
 * Immediate abort on "stop", "cancel", "abort" commands
 * without waiting for LLM processing.
 */

const STOP_PATTERNS = [
  /^(stop|cancel|abort|halt|quit)$/i,
  /^(stop|cancel|abort|halt|quit)\s+.*/i,
  /^\/stop$/i,
  /^\/cancel$/i,
  /^\/abort$/i,
];

export type StopReflexResult = {
  matched: boolean;
  action: "abort" | null;
};

export function checkStopReflex(message: string): StopReflexResult {
  const trimmed = message.trim();

  for (const pattern of STOP_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        matched: true,
        action: "abort",
      };
    }
  }

  return {
    matched: false,
    action: null,
  };
}
