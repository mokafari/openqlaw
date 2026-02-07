/**
 * Stack Trace Analyzer
 *
 * Provides semantic understanding of error stack traces:
 * - Parses and structures stack traces
 * - Adds source context around each frame
 * - Classifies error types
 * - Finds similar past errors
 * - Suggests fixes based on patterns
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface StackFrame {
  file: string;
  line: number;
  column?: number;
  function: string;
  isInternal: boolean;
  sourceContext?: string[];
}

export type ErrorCategory =
  | "user_input"
  | "config"
  | "bug"
  | "external"
  | "race_condition"
  | "resource";

export interface ParsedStackTrace {
  error: string;
  message: string;
  frames: StackFrame[];
  category: ErrorCategory;
  raw?: string;
}

export interface ErrorMatch {
  similarity: number;
  pastError: string;
  resolution?: string;
  timestamp: number;
}

export interface ErrorHistoryEntry {
  timestamp: number;
  error: string;
  message: string;
  category: ErrorCategory;
  frames: Array<{ file: string; line: number; function: string }>;
  resolution?: string;
  hash: string;
}

// ============================================================================
// Constants
// ============================================================================

const ERROR_HISTORY_PATH = path.join(resolveStateDir(), "evolution", "error-history.jsonl");

// Patterns for classification - order matters within categories
// We use an ordered array of [category, patterns] to check in specific order
const CLASSIFICATION_ORDER: Array<[ErrorCategory, RegExp[]]> = [
  // Check resource errors first (most specific filesystem errors)
  [
    "resource",
    [
      /ENOENT/i,
      /EACCES/i,
      /EPERM/i,
      /ENOMEM/i,
      /ENOSPC/i,
      /file not found/i,
      /permission denied/i,
      /out of memory/i,
      /disk full/i,
    ],
  ],
  // External service errors
  [
    "external",
    [
      /ECONNREFUSED/i,
      /ETIMEDOUT/i,
      /ENOTFOUND/i,
      /network error/i,
      /fetch failed/i,
      /socket hang up/i,
      /API (error|limit|rate)/i,
      /status code [45]\d{2}/i,
    ],
  ],
  // Race conditions
  [
    "race_condition",
    [
      /already (closed|disposed|destroyed)/i,
      /concurrent (access|modification)/i,
      /deadlock/i,
      /timeout waiting for lock/i,
      /resource busy/i,
    ],
  ],
  // User input validation errors
  [
    "user_input",
    [
      /invalid (input|argument|parameter)/i,
      /validation (failed|error)/i,
      /expected .+ but (got|received)/i,
      /missing required/i,
      /cannot parse/i,
      /malformed/i,
    ],
  ],
  // Config errors (checked after resource since ENOENT takes precedence)
  [
    "config",
    [
      /config(uration)? (error|not found|invalid)/i,
      /missing (env|environment)/i,
      /invalid option/i,
      /unknown property/i,
      /schema validation/i,
    ],
  ],
  // Code bugs (most general, checked last)
  [
    "bug",
    [
      /cannot read propert/i,
      /is not a function/i,
      /is not defined/i,
      /undefined is not/i,
      /null is not/i,
      /TypeError/i,
      /ReferenceError/i,
      /assertion failed/i,
    ],
  ],
];

// Also keep the record for backwards compat and fix suggestions lookup
const CLASSIFICATION_PATTERNS: Record<ErrorCategory, RegExp[]> = Object.fromEntries(
  CLASSIFICATION_ORDER,
) as Record<ErrorCategory, RegExp[]>;

// Fix suggestions by category and pattern
const FIX_SUGGESTIONS: Record<string, { pattern: RegExp; suggestions: string[] }[]> = {
  user_input: [
    {
      pattern: /missing required/i,
      suggestions: [
        "Check that all required parameters are provided",
        "Add input validation with clear error messages",
        "Document required fields in function signature",
      ],
    },
    {
      pattern: /cannot parse/i,
      suggestions: [
        "Validate input format before parsing",
        "Add try-catch around parsing logic",
        "Provide example of expected format in error message",
      ],
    },
  ],
  config: [
    {
      pattern: /ENOENT.*config/i,
      suggestions: [
        "Ensure config file exists at expected path",
        "Add fallback to default configuration",
        "Check environment variable for config path override",
      ],
    },
    {
      pattern: /missing (env|environment)/i,
      suggestions: [
        "Set required environment variable",
        "Add .env file with required variables",
        "Document required environment variables in README",
      ],
    },
  ],
  bug: [
    {
      pattern: /cannot read propert/i,
      suggestions: [
        "Add null/undefined check before property access",
        "Use optional chaining (?.) for safe property access",
        "Initialize object before use",
      ],
    },
    {
      pattern: /is not a function/i,
      suggestions: [
        "Check that the method exists on the object",
        "Verify import/export is correct",
        "Check for typos in function name",
      ],
    },
    {
      pattern: /is not defined/i,
      suggestions: [
        "Import or declare the variable before use",
        "Check for typos in variable name",
        "Verify the scope of the variable",
      ],
    },
  ],
  external: [
    {
      pattern: /ECONNREFUSED/i,
      suggestions: [
        "Verify the service is running and accessible",
        "Check the host and port configuration",
        "Add retry logic with exponential backoff",
      ],
    },
    {
      pattern: /ETIMEDOUT/i,
      suggestions: [
        "Increase timeout configuration",
        "Check network connectivity",
        "Add circuit breaker pattern for failing services",
      ],
    },
    {
      pattern: /API (error|limit|rate)/i,
      suggestions: [
        "Implement rate limiting on client side",
        "Add request queuing and throttling",
        "Cache responses where appropriate",
      ],
    },
  ],
  race_condition: [
    {
      pattern: /already (closed|disposed)/i,
      suggestions: [
        "Check resource state before use",
        "Add proper lifecycle management",
        "Use mutex or semaphore for resource access",
      ],
    },
  ],
  resource: [
    {
      pattern: /ENOENT/i,
      suggestions: [
        "Verify file path is correct",
        "Check that parent directory exists",
        "Create file/directory if it should exist",
      ],
    },
    {
      pattern: /EACCES|EPERM/i,
      suggestions: [
        "Check file/directory permissions",
        "Run with appropriate privileges",
        "Use a different path with write access",
      ],
    },
  ],
};

// ============================================================================
// Stack Trace Parsing
// ============================================================================

/**
 * Parse a raw stack trace string into structured format.
 */
export async function parseStackTrace(raw: string): Promise<ParsedStackTrace> {
  const lines = raw.split("\n").map((l) => l.trim());

  // Find error line (first line that looks like an error)
  let errorLine = "";
  let messageStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match patterns like "Error: message" or "TypeError: message"
    const errorMatch = line.match(/^(\w*Error):?\s*(.*)/);
    if (errorMatch) {
      errorLine = line;
      messageStart = i;
      break;
    }
  }

  // Extract error type and message
  const errorTypeMatch = errorLine.match(/^(\w+Error):\s*(.*)$/);
  const error = errorTypeMatch?.[1] ?? "Error";
  const message =
    errorTypeMatch?.[2] ?? errorLine.replace(/^\w+Error:\s*/, "").replace(/^Error:\s*/, "");

  // Parse stack frames
  const frames: StackFrame[] = [];

  for (let i = messageStart + 1; i < lines.length; i++) {
    const line = lines[i];
    const frame = parseStackFrame(line);
    if (frame) {
      frames.push(frame);
    }
  }

  // Classify the error
  const category = classifyFromContent(error, message, frames);

  return {
    error,
    message,
    frames,
    category,
    raw,
  };
}

/**
 * Parse a single stack frame line.
 */
function parseStackFrame(line: string): StackFrame | null {
  // Node.js format: "    at functionName (file:line:col)"
  const nodeMatch = line.match(/^\s*at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+)|(.+?))\)?$/);

  if (nodeMatch) {
    const func = nodeMatch[1] ?? "<anonymous>";
    const file = nodeMatch[2] ?? nodeMatch[5] ?? "<unknown>";
    const lineNum = nodeMatch[3] ? parseInt(nodeMatch[3], 10) : 0;
    const column = nodeMatch[4] ? parseInt(nodeMatch[4], 10) : undefined;

    const isInternal =
      file.includes("node_modules") ||
      file.includes("internal/") ||
      file.startsWith("node:") ||
      !file.includes("/");

    return {
      file,
      line: lineNum,
      column,
      function: func,
      isInternal,
    };
  }

  // V8 format: "    at file:line:col"
  const v8Match = line.match(/^\s*at\s+(.+?):(\d+):(\d+)$/);
  if (v8Match) {
    const file = v8Match[1];
    const lineNum = parseInt(v8Match[2], 10);
    const column = parseInt(v8Match[3], 10);

    const isInternal =
      file.includes("node_modules") || file.includes("internal/") || file.startsWith("node:");

    return {
      file,
      line: lineNum,
      column,
      function: "<anonymous>",
      isInternal,
    };
  }

  return null;
}

/**
 * Classify error from content without full parsing.
 */
function classifyFromContent(error: string, message: string, frames: StackFrame[]): ErrorCategory {
  const combined = `${error}: ${message}`;

  // Check patterns in priority order
  for (const [category, patterns] of CLASSIFICATION_ORDER) {
    for (const pattern of patterns) {
      if (pattern.test(combined)) {
        return category;
      }
    }
  }

  // Heuristics based on error type
  if (error === "TypeError" || error === "ReferenceError") {
    return "bug";
  }
  if (error === "SyntaxError") {
    return "config";
  }
  if (error === "RangeError") {
    return "user_input";
  }

  // Check frames for hints
  const hasUserFrame = frames.some((f) => !f.isInternal);
  if (!hasUserFrame) {
    return "external";
  }

  // Default to bug
  return "bug";
}

// ============================================================================
// Source Context
// ============================================================================

/**
 * Add source context to stack frames.
 */
export async function contextualize(
  parsed: ParsedStackTrace,
  maxLines: number = 5,
): Promise<ParsedStackTrace> {
  const contextualizedFrames: StackFrame[] = [];

  for (const frame of parsed.frames) {
    // Skip internal frames
    if (frame.isInternal || !frame.line) {
      contextualizedFrames.push(frame);
      continue;
    }

    try {
      const sourceContext = await extractSourceContext(frame.file, frame.line, maxLines);
      contextualizedFrames.push({
        ...frame,
        sourceContext,
      });
    } catch {
      // File not readable, keep frame without context
      contextualizedFrames.push(frame);
    }
  }

  return {
    ...parsed,
    frames: contextualizedFrames,
  };
}

/**
 * Extract source code context around a line.
 * Returns undefined if the file cannot be read.
 */
async function extractSourceContext(
  filePath: string,
  line: number,
  maxLines: number,
): Promise<string[] | undefined> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    const start = Math.max(0, line - Math.floor(maxLines / 2) - 1);
    const end = Math.min(lines.length, line + Math.ceil(maxLines / 2));

    const contextLines: string[] = [];
    for (let i = start; i < end; i++) {
      const lineNum = i + 1;
      const marker = lineNum === line ? ">" : " ";
      contextLines.push(`${marker} ${lineNum.toString().padStart(4)} | ${lines[i]}`);
    }

    return contextLines.length > 0 ? contextLines : undefined;
  } catch {
    return undefined;
  }
}

// ============================================================================
// Classification
// ============================================================================

/**
 * Classify a parsed stack trace into a category.
 */
export async function classify(parsed: ParsedStackTrace): Promise<ErrorCategory> {
  // Re-run classification with full data
  const combined = `${parsed.error}: ${parsed.message}`;

  // Check patterns in priority order
  for (const [category, patterns] of CLASSIFICATION_ORDER) {
    for (const pattern of patterns) {
      if (pattern.test(combined)) {
        return category;
      }
    }
  }

  // Additional heuristics from context
  if (parsed.frames.length > 0) {
    const topFrame = parsed.frames.find((f) => !f.isInternal);
    if (topFrame?.sourceContext?.length) {
      const contextText = topFrame.sourceContext.join("\n");

      // Check for async patterns (potential race condition)
      if (/await|Promise|async/i.test(contextText)) {
        if (/close|dispose|destroy/i.test(parsed.message)) {
          return "race_condition";
        }
      }

      // Check for external calls
      if (/fetch|axios|http|request/i.test(contextText)) {
        if (/timeout|connection|network/i.test(parsed.message)) {
          return "external";
        }
      }
    }
  }

  return parsed.category;
}

// ============================================================================
// Fix Suggestions
// ============================================================================

/**
 * Suggest fixes based on the parsed stack trace.
 */
export async function suggestFix(parsed: ParsedStackTrace): Promise<string[]> {
  const suggestions: string[] = [];
  const combined = `${parsed.error}: ${parsed.message}`;

  // Get category-specific suggestions
  const categoryPatterns = FIX_SUGGESTIONS[parsed.category] ?? [];
  for (const { pattern, suggestions: fixes } of categoryPatterns) {
    if (pattern.test(combined)) {
      suggestions.push(...fixes);
    }
  }

  // Check all categories for matching patterns
  for (const [, patterns] of Object.entries(FIX_SUGGESTIONS)) {
    for (const { pattern, suggestions: fixes } of patterns) {
      if (pattern.test(combined) && !suggestions.includes(fixes[0])) {
        suggestions.push(...fixes.slice(0, 2));
      }
    }
  }

  // Add context-aware suggestions
  if (parsed.frames.length > 0) {
    const topUserFrame = parsed.frames.find((f) => !f.isInternal);
    if (topUserFrame) {
      suggestions.push(`Review code at ${topUserFrame.file}:${topUserFrame.line}`);
    }
  }

  // Limit and dedupe
  const unique = [...new Set(suggestions)];
  return unique.slice(0, 5);
}

// ============================================================================
// Error History & Similarity
// ============================================================================

/**
 * Compute a hash for an error (for similarity matching).
 */
function computeErrorHash(parsed: ParsedStackTrace): string {
  // Create fingerprint from error type, message pattern, and top frames
  const messagePattern = parsed.message
    .replace(/["'].*?["']/g, "'...'") // Replace quoted strings
    .replace(/\d+/g, "N") // Replace numbers
    .replace(/[a-f0-9]{8,}/gi, "HASH"); // Replace hashes

  const topFrames = parsed.frames
    .filter((f) => !f.isInternal)
    .slice(0, 3)
    .map((f) => `${f.function}@${path.basename(f.file)}:${f.line}`);

  const fingerprint = `${parsed.error}:${messagePattern}|${topFrames.join(",")}`;

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Calculate similarity between two error hashes/patterns.
 */
function calculateSimilarity(parsed: ParsedStackTrace, entry: ErrorHistoryEntry): number {
  let score = 0;

  // Same error type: +0.3
  if (parsed.error === entry.error) {
    score += 0.3;
  }

  // Same category: +0.2
  if (parsed.category === entry.category) {
    score += 0.2;
  }

  // Message similarity (simple word overlap)
  const parsedWords = new Set(parsed.message.toLowerCase().split(/\W+/));
  const entryWords = new Set(entry.message.toLowerCase().split(/\W+/));
  const intersection = [...parsedWords].filter((w) => entryWords.has(w));
  const union = new Set([...parsedWords, ...entryWords]);
  const jaccard = intersection.length / union.size;
  score += jaccard * 0.3;

  // Frame overlap
  const parsedFrames = new Set(parsed.frames.filter((f) => !f.isInternal).map((f) => f.function));
  const entryFrames = new Set(entry.frames.map((f) => f.function));
  const frameIntersection = [...parsedFrames].filter((f) => entryFrames.has(f));
  const frameUnion = new Set([...parsedFrames, ...entryFrames]);
  const frameJaccard = frameUnion.size > 0 ? frameIntersection.length / frameUnion.size : 0;
  score += frameJaccard * 0.2;

  return Math.min(1, score);
}

/**
 * Load error history from file.
 */
async function loadErrorHistory(): Promise<ErrorHistoryEntry[]> {
  try {
    const content = await fs.readFile(ERROR_HISTORY_PATH, "utf-8");
    const entries: ErrorHistoryEntry[] = [];

    for (const line of content.split("\n")) {
      if (line.trim()) {
        try {
          entries.push(JSON.parse(line) as ErrorHistoryEntry);
        } catch {
          // Skip malformed lines
        }
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Save an error to history.
 */
export async function saveToHistory(parsed: ParsedStackTrace, resolution?: string): Promise<void> {
  const entry: ErrorHistoryEntry = {
    timestamp: Date.now(),
    error: parsed.error,
    message: parsed.message,
    category: parsed.category,
    frames: parsed.frames
      .filter((f) => !f.isInternal)
      .slice(0, 5)
      .map((f) => ({
        file: f.file,
        line: f.line,
        function: f.function,
      })),
    resolution,
    hash: computeErrorHash(parsed),
  };

  // Ensure directory exists
  await fs.mkdir(path.dirname(ERROR_HISTORY_PATH), { recursive: true });

  // Append to file
  await fs.appendFile(ERROR_HISTORY_PATH, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Find similar past errors.
 */
export async function findSimilar(
  parsed: ParsedStackTrace,
  limit: number = 5,
): Promise<ErrorMatch[]> {
  const history = await loadErrorHistory();

  const matches: ErrorMatch[] = history
    .map((entry) => ({
      similarity: calculateSimilarity(parsed, entry),
      pastError: `${entry.error}: ${entry.message}`,
      resolution: entry.resolution,
      timestamp: entry.timestamp,
    }))
    .filter((m) => m.similarity > 0.3) // Minimum threshold
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return matches;
}

// ============================================================================
// Human-Readable Explanation
// ============================================================================

/**
 * Generate a human-readable explanation of the error.
 */
export async function explain(parsed: ParsedStackTrace): Promise<string> {
  const parts: string[] = [];

  // Error summary
  parts.push(`## ${parsed.error}`);
  parts.push("");
  parts.push(`**Message:** ${parsed.message}`);
  parts.push(`**Category:** ${categoryDescription(parsed.category)}`);
  parts.push("");

  // Top frames
  const userFrames = parsed.frames.filter((f) => !f.isInternal).slice(0, 3);
  if (userFrames.length > 0) {
    parts.push("### Stack Trace (user code)");
    for (const frame of userFrames) {
      parts.push(`- \`${frame.function}\` at \`${frame.file}:${frame.line}\``);
      if (frame.sourceContext?.length) {
        parts.push("```");
        parts.push(...frame.sourceContext);
        parts.push("```");
      }
    }
    parts.push("");
  }

  // Analysis
  parts.push("### Analysis");
  parts.push(categoryAnalysis(parsed.category, parsed.message));
  parts.push("");

  // Suggestions
  const suggestions = await suggestFix(parsed);
  if (suggestions.length > 0) {
    parts.push("### Suggested Fixes");
    for (const suggestion of suggestions) {
      parts.push(`- ${suggestion}`);
    }
    parts.push("");
  }

  // Similar errors
  const similar = await findSimilar(parsed, 3);
  if (similar.length > 0) {
    parts.push("### Similar Past Errors");
    for (const match of similar) {
      const date = new Date(match.timestamp).toISOString().split("T")[0];
      parts.push(`- (${(match.similarity * 100).toFixed(0)}% match, ${date}): ${match.pastError}`);
      if (match.resolution) {
        parts.push(`  - **Resolution:** ${match.resolution}`);
      }
    }
  }

  return parts.join("\n");
}

/**
 * Get human-readable description for a category.
 */
function categoryDescription(category: ErrorCategory): string {
  switch (category) {
    case "user_input":
      return "Invalid User Input";
    case "config":
      return "Configuration Error";
    case "bug":
      return "Code Bug";
    case "external":
      return "External Service Error";
    case "race_condition":
      return "Race Condition";
    case "resource":
      return "Resource Access Error";
  }
}

/**
 * Get analysis text for a category.
 */
function categoryAnalysis(category: ErrorCategory, message: string): string {
  switch (category) {
    case "user_input":
      return (
        "This error indicates invalid input was provided. " +
        "Check the input values and ensure they meet the expected format and constraints."
      );
    case "config":
      return (
        "This error suggests a configuration issue. " +
        "Verify that all required configuration files exist and contain valid values."
      );
    case "bug":
      return (
        "This appears to be a code bug. " +
        "Review the code at the indicated location for null/undefined handling, " +
        "type mismatches, or incorrect function calls."
      );
    case "external":
      return (
        "This error originates from an external service or network issue. " +
        "Check service availability, network connectivity, and API credentials."
      );
    case "race_condition":
      return (
        "This error may be caused by a race condition or resource lifecycle issue. " +
        "Review the async code flow and ensure proper synchronization."
      );
    case "resource":
      return (
        "This error relates to file system or resource access. " +
        "Verify file paths, permissions, and resource availability."
      );
  }
}

// ============================================================================
// Utility Exports
// ============================================================================

/**
 * Full analysis pipeline: parse → contextualize → classify → explain.
 */
export async function analyzeStackTrace(raw: string): Promise<{
  parsed: ParsedStackTrace;
  explanation: string;
  suggestions: string[];
  similar: ErrorMatch[];
}> {
  let parsed = await parseStackTrace(raw);
  parsed = await contextualize(parsed);
  const category = await classify(parsed);
  parsed = { ...parsed, category };

  const [explanation, suggestions, similar] = await Promise.all([
    explain(parsed),
    suggestFix(parsed),
    findSimilar(parsed),
  ]);

  return { parsed, explanation, suggestions, similar };
}
