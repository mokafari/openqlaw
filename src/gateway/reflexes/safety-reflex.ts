/**
 * Safety Reflex
 *
 * Block dangerous patterns before LLM processing.
 */

const DANGEROUS_PATTERNS = [
  // System-level commands
  /rm\s+-rf\s+\//,
  /format\s+c:/i,
  /del\s+\/s\s+\/q\s+c:\\/i,

  // Database operations
  /drop\s+table/i,
  /delete\s+from\s+\w+\s+where\s+1\s*=\s*1/i,
  /truncate\s+table/i,

  // Network operations
  /curl\s+.*\|\s*sh/i,
  /wget\s+.*\|\s*sh/i,
  /bash\s+<\(curl/i,
];

const SUSPICIOUS_PATTERNS = [
  // Base64 encoded commands
  /echo\s+[A-Za-z0-9+\/]{100,}/,

  // Obfuscated scripts
  /eval\s*\(/i,
  /exec\s*\(/i,

  // Password/credential requests
  /password\s*[:=]\s*["']/i,
  /api[_-]?key\s*[:=]\s*["']/i,
];

export type SafetyReflexResult = {
  blocked: boolean;
  reason?: string;
  severity: "dangerous" | "suspicious" | "safe";
};

export function checkSafetyReflex(message: string): SafetyReflexResult {
  const trimmed = message.trim();

  // Check dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        blocked: true,
        reason: "Potentially dangerous command detected",
        severity: "dangerous",
      };
    }
  }

  // Check suspicious patterns (warn but don't block)
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        blocked: false,
        reason: "Suspicious pattern detected",
        severity: "suspicious",
      };
    }
  }

  return {
    blocked: false,
    severity: "safe",
  };
}
