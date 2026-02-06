/**
 * Eliza-style Pattern Matching
 *
 * Simple pattern matching for personality-aware responses.
 * Inspired by Quake III Arena Bot's Eliza chat system.
 */

import type { TriggerEvent } from "./triggers.js";
import { detectTriggerEvent, getTriggerResponse, selectTriggerVariant } from "./triggers.js";

export type ElizaPattern = {
  pattern: RegExp;
  event?: TriggerEvent;
  response?: string;
  weight?: number;
};

const ELIZA_PATTERNS: ElizaPattern[] = [
  {
    pattern: /^(hi|hello|hey|greetings)/i,
    response: "Hello! How can I help?",
    weight: 1.0,
  },
  {
    pattern: /(thanks|thank you|ty|thx)/i,
    response: "You're welcome!",
    weight: 1.0,
  },
  {
    pattern: /(sorry|apologize|my bad)/i,
    response: "No worries!",
    weight: 0.8,
  },
  {
    pattern: /(how are you|how's it going)/i,
    response: "I'm doing well, thanks for asking!",
    weight: 0.9,
  },
  {
    pattern: /(what can you do|what do you do|capabilities)/i,
    response: "I can help with coding, file operations, web searches, and more. What do you need?",
    weight: 0.7,
  },
  {
    pattern: /(build|compile).*(fail|error|broken)/i,
    event: "BUILD_FAILED",
    weight: 0.9,
  },
  {
    pattern: /(test).*(fail|error|broken)/i,
    event: "TEST_FAILED",
    weight: 0.9,
  },
  {
    pattern: /(deploy|deployment).*(fail|error|broken)/i,
    event: "DEPLOYMENT_FAILED",
    weight: 0.9,
  },
  {
    pattern: /(build|compile).*(success|pass|working)/i,
    event: "BUILD_SUCCESS",
    weight: 0.9,
  },
  {
    pattern: /(test).*(pass|green|success)/i,
    event: "TEST_PASSED",
    weight: 0.9,
  },
];

export function matchElizaPattern(message: string): ElizaPattern | null {
  let bestMatch: ElizaPattern | null = null;
  let bestWeight = 0;

  for (const pattern of ELIZA_PATTERNS) {
    if (pattern.pattern.test(message)) {
      const weight = pattern.weight ?? 0.5;
      if (weight > bestWeight) {
        bestWeight = weight;
        bestMatch = pattern;
      }
    }
  }

  return bestMatch;
}

export function generateElizaResponse(
  message: string,
  context?: {
    hour?: number;
    isFirstInteraction?: boolean;
    isMentioned?: boolean;
  },
): string | null {
  const pattern = matchElizaPattern(message);

  if (pattern?.response) {
    return pattern.response;
  }

  if (pattern?.event) {
    const triggerResponse = getTriggerResponse(pattern.event);
    return selectTriggerVariant(triggerResponse);
  }

  // Fallback to event detection
  const event = detectTriggerEvent({
    message,
    hour: context?.hour,
    isFirstInteraction: context?.isFirstInteraction,
    isMentioned: context?.isMentioned,
  });

  if (event) {
    const triggerResponse = getTriggerResponse(event);
    return selectTriggerVariant(triggerResponse);
  }

  return null;
}
