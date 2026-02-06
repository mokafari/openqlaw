/**
 * Priority Reflex
 *
 * Fast-path for simple queries that don't need LLM processing.
 */

const TIME_PATTERNS = [/^(what|what's|tell me).*time/i, /^time\??$/i, /^what time/i];

const STATUS_PATTERNS = [
  /^(status|state|health)$/i,
  /^(how|what).*(status|state|health)/i,
  /^\/status$/i,
];

const SIMPLE_QUERIES: Array<{ pattern: RegExp; response: string }> = [
  {
    pattern: /^(hi|hello|hey)$/i,
    response: "Hello! How can I help?",
  },
  {
    pattern: /^(thanks|thank you|ty)$/i,
    response: "You're welcome!",
  },
  {
    pattern: /^(ok|okay|k)$/i,
    response: "Got it.",
  },
];

export type PriorityReflexResult = {
  matched: boolean;
  response?: string;
  action?: "time" | "status" | "simple";
};

export function checkPriorityReflex(message: string): PriorityReflexResult {
  const trimmed = message.trim();

  // Check simple queries first
  for (const query of SIMPLE_QUERIES) {
    if (query.pattern.test(trimmed)) {
      return {
        matched: true,
        response: query.response,
        action: "simple",
      };
    }
  }

  // Check time queries
  for (const pattern of TIME_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        matched: true,
        action: "time",
      };
    }
  }

  // Check status queries
  for (const pattern of STATUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        matched: true,
        action: "status",
      };
    }
  }

  return {
    matched: false,
  };
}
