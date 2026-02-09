/**
 * Context Summarization Strategies — Phase 2 Monitoring Infrastructure
 *
 * Implements advanced summarization strategies for efficient context management:
 * - Selective history compression (keep recent, summarize older)
 * - Token-efficient fact extraction
 * - Semantic deduplication
 * - Priority-based retention
 *
 * Created: 2026-02-08
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import { getContextMonitor, PRESERVE_RECENT_MESSAGES } from "./context-monitor.js";

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface MessageLike {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  toolCalls?: unknown[];
  metadata?: Record<string, unknown>;
}

export interface SummarizationResult {
  originalTokens: number;
  resultTokens: number;
  compressionRatio: number;
  messages: MessageLike[];
  summary?: string;
  preservedDecisions: string[];
  duration: number;
}

export interface SummarizationOptions {
  preserveRecentCount?: number;
  preserveDecisions?: boolean;
  preserveToolResults?: boolean;
  aggressiveCompression?: boolean;
  maxOutputTokens?: number;
}

export type SummarizationStrategy =
  | "selective-history"
  | "fact-extraction"
  | "semantic-dedup"
  | "priority-retention"
  | "hybrid";

// ────────────────────────────────────────────────────────────────
// Token Estimation
// ────────────────────────────────────────────────────────────────

/**
 * Rough token estimation (4 chars ≈ 1 token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: MessageLike[]): number {
  return messages.reduce((sum, m) => {
    let tokens = estimateTokens(m.content);
    // Add overhead for role and structure
    tokens += 4;
    // Add tokens for tool calls if present
    if (m.toolCalls && Array.isArray(m.toolCalls)) {
      tokens += estimateTokens(JSON.stringify(m.toolCalls));
    }
    return sum + tokens;
  }, 0);
}

// ────────────────────────────────────────────────────────────────
// Summarization Strategies
// ────────────────────────────────────────────────────────────────

const logger = createSubsystemLogger("context-summarization");

/**
 * Selective History Compression
 *
 * Keeps the last N messages intact, summarizes older messages into
 * a condensed format preserving key decisions and outcomes.
 */
export function selectiveHistoryCompression(
  messages: MessageLike[],
  options: SummarizationOptions = {},
): SummarizationResult {
  const startTime = Date.now();
  const preserveCount = options.preserveRecentCount ?? PRESERVE_RECENT_MESSAGES;
  const originalTokens = estimateMessagesTokens(messages);

  if (messages.length <= preserveCount) {
    return {
      originalTokens,
      resultTokens: originalTokens,
      compressionRatio: 1,
      messages,
      preservedDecisions: [],
      duration: Date.now() - startTime,
    };
  }

  const recentMessages = messages.slice(-preserveCount);
  const olderMessages = messages.slice(0, -preserveCount);

  // Extract key decisions and outcomes from older messages
  const decisions = extractDecisions(olderMessages);
  const outcomes = extractOutcomes(olderMessages);

  // Create summary of older context
  const summaryParts: string[] = [];

  if (decisions.length > 0) {
    summaryParts.push(`Key Decisions:\n${decisions.map((d) => `• ${d}`).join("\n")}`);
  }

  if (outcomes.length > 0) {
    summaryParts.push(`Outcomes:\n${outcomes.map((o) => `• ${o}`).join("\n")}`);
  }

  // Add context about what was discussed
  const topicSummary = summarizeTopics(olderMessages);
  if (topicSummary) {
    summaryParts.push(`Topics Covered: ${topicSummary}`);
  }

  const summaryContent = summaryParts.join("\n\n");
  const summaryMessage: MessageLike = {
    role: "system",
    content: `[Context Summary - ${olderMessages.length} messages compressed]\n\n${summaryContent}`,
    timestamp: Date.now(),
    metadata: { summarized: true, originalCount: olderMessages.length },
  };

  const resultMessages = [summaryMessage, ...recentMessages];
  const resultTokens = estimateMessagesTokens(resultMessages);

  return {
    originalTokens,
    resultTokens,
    compressionRatio: resultTokens / originalTokens,
    messages: resultMessages,
    summary: summaryContent,
    preservedDecisions: decisions,
    duration: Date.now() - startTime,
  };
}

/**
 * Token-Efficient Fact Extraction
 *
 * Converts verbose logs and outputs into concise bullet points.
 * Particularly effective for tool outputs and long explanations.
 */
export function factExtraction(
  messages: MessageLike[],
  options: SummarizationOptions = {},
): SummarizationResult {
  const startTime = Date.now();
  const originalTokens = estimateMessagesTokens(messages);
  const resultMessages: MessageLike[] = [];

  for (const message of messages) {
    // Check if content is verbose (>500 tokens)
    const contentTokens = estimateTokens(message.content);

    if (contentTokens > 500 && message.role === "assistant") {
      // Extract key facts
      const facts = extractFacts(message.content);
      const compressedContent =
        facts.length > 0
          ? `Key points:\n${facts.map((f) => `• ${f}`).join("\n")}`
          : message.content.slice(0, 500) + "...";

      resultMessages.push({
        ...message,
        content: compressedContent,
        metadata: { ...message.metadata, compressed: true, originalLength: message.content.length },
      });
    } else {
      resultMessages.push(message);
    }
  }

  const resultTokens = estimateMessagesTokens(resultMessages);

  return {
    originalTokens,
    resultTokens,
    compressionRatio: resultTokens / originalTokens,
    messages: resultMessages,
    preservedDecisions: [],
    duration: Date.now() - startTime,
  };
}

/**
 * Semantic Deduplication
 *
 * Merges similar concepts and removes redundant information.
 * Uses simple heuristics to detect repetition.
 */
export function semanticDeduplication(
  messages: MessageLike[],
  options: SummarizationOptions = {},
): SummarizationResult {
  const startTime = Date.now();
  const originalTokens = estimateMessagesTokens(messages);

  const seenConcepts = new Set<string>();
  const resultMessages: MessageLike[] = [];

  for (const message of messages) {
    // Extract key phrases/concepts from message
    const concepts = extractConcepts(message.content);

    // Check for significant overlap with seen concepts
    const overlapCount = concepts.filter((c) => seenConcepts.has(c)).length;
    const overlapRatio = concepts.length > 0 ? overlapCount / concepts.length : 0;

    if (overlapRatio > 0.7 && message.role !== "system") {
      // High overlap - skip or summarize
      const uniqueConcepts = concepts.filter((c) => !seenConcepts.has(c));
      if (uniqueConcepts.length > 0) {
        // Keep only unique information
        resultMessages.push({
          ...message,
          content: `[Condensed] ${uniqueConcepts.join(", ")}`,
          metadata: { ...message.metadata, deduplicated: true },
        });
      }
      // Otherwise skip entirely
    } else {
      resultMessages.push(message);
    }

    // Add new concepts to seen set
    concepts.forEach((c) => seenConcepts.add(c));
  }

  const resultTokens = estimateMessagesTokens(resultMessages);

  return {
    originalTokens,
    resultTokens,
    compressionRatio: resultTokens / originalTokens,
    messages: resultMessages,
    preservedDecisions: [],
    duration: Date.now() - startTime,
  };
}

/**
 * Priority-Based Retention
 *
 * Preserves critical decisions and deprecates repetitive/low-value content.
 * Uses message metadata and content analysis to determine priority.
 */
export function priorityRetention(
  messages: MessageLike[],
  options: SummarizationOptions = {},
): SummarizationResult {
  const startTime = Date.now();
  const originalTokens = estimateMessagesTokens(messages);

  const scored = messages.map((m) => ({
    message: m,
    priority: scoreMessagePriority(m),
  }));

  // Sort by priority
  scored.sort((a, b) => b.priority - a.priority);

  // Calculate target token budget (50% of original or maxOutputTokens)
  const targetTokens = options.maxOutputTokens ?? Math.floor(originalTokens * 0.5);

  const resultMessages: MessageLike[] = [];
  let currentTokens = 0;

  for (const { message } of scored) {
    const messageTokens = estimateMessagesTokens([message]);
    if (currentTokens + messageTokens <= targetTokens) {
      resultMessages.push(message);
      currentTokens += messageTokens;
    } else if (options.aggressiveCompression) {
      // Add a compressed version
      const compressed = compressMessage(message);
      const compressedTokens = estimateMessagesTokens([compressed]);
      if (currentTokens + compressedTokens <= targetTokens) {
        resultMessages.push(compressed);
        currentTokens += compressedTokens;
      }
    }
  }

  // Re-sort by original order (using timestamp if available)
  resultMessages.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  const resultTokens = estimateMessagesTokens(resultMessages);

  return {
    originalTokens,
    resultTokens,
    compressionRatio: resultTokens / originalTokens,
    messages: resultMessages,
    preservedDecisions: extractDecisions(resultMessages),
    duration: Date.now() - startTime,
  };
}

/**
 * Hybrid Summarization
 *
 * Combines multiple strategies for optimal compression:
 * 1. First applies selective history compression
 * 2. Then applies fact extraction to verbose messages
 * 3. Finally applies semantic deduplication
 */
export function hybridSummarization(
  messages: MessageLike[],
  options: SummarizationOptions = {},
): SummarizationResult {
  const startTime = Date.now();
  const originalTokens = estimateMessagesTokens(messages);

  // Step 1: Selective history compression
  let result = selectiveHistoryCompression(messages, options);

  // Step 2: Fact extraction on remaining verbose messages
  result = factExtraction(result.messages, options);

  // Step 3: Semantic deduplication
  result = semanticDeduplication(result.messages, options);

  const resultTokens = estimateMessagesTokens(result.messages);

  return {
    originalTokens,
    resultTokens,
    compressionRatio: resultTokens / originalTokens,
    messages: result.messages,
    summary: result.summary,
    preservedDecisions: result.preservedDecisions,
    duration: Date.now() - startTime,
  };
}

// ────────────────────────────────────────────────────────────────
// Helper Functions
// ────────────────────────────────────────────────────────────────

function extractDecisions(messages: MessageLike[]): string[] {
  const decisions: string[] = [];
  const decisionPatterns = [
    /I('ll| will) (do|implement|create|fix|add|use|set|configure)/gi,
    /decided to/gi,
    /choosing to/gi,
    /going (to|with)/gi,
    /plan is to/gi,
  ];

  for (const message of messages) {
    if (message.role !== "assistant") continue;

    const sentences = message.content.split(/[.!?]+/).filter((s) => s.trim().length > 10);
    for (const sentence of sentences) {
      for (const pattern of decisionPatterns) {
        if (pattern.test(sentence)) {
          decisions.push(sentence.trim().slice(0, 100));
          pattern.lastIndex = 0; // Reset regex state
          break;
        }
      }
    }
  }

  return [...new Set(decisions)].slice(0, 10); // Dedupe and limit
}

function extractOutcomes(messages: MessageLike[]): string[] {
  const outcomes: string[] = [];
  const outcomePatterns = [
    /successfully/gi,
    /completed/gi,
    /created/gi,
    /fixed/gi,
    /resolved/gi,
    /error:/gi,
    /failed/gi,
    /warning:/gi,
  ];

  for (const message of messages) {
    if (message.role !== "assistant") continue;

    const sentences = message.content.split(/[.!?]+/).filter((s) => s.trim().length > 10);
    for (const sentence of sentences) {
      for (const pattern of outcomePatterns) {
        if (pattern.test(sentence)) {
          outcomes.push(sentence.trim().slice(0, 80));
          pattern.lastIndex = 0;
          break;
        }
      }
    }
  }

  return [...new Set(outcomes)].slice(0, 8);
}

function summarizeTopics(messages: MessageLike[]): string {
  const topics = new Set<string>();
  const topicPatterns = [
    /(?:working on|implementing|fixing|creating|setting up)\s+([^.!?]+)/gi,
    /(?:the|a)\s+([\w-]+\s+(?:system|service|module|feature|bug|issue))/gi,
  ];

  for (const message of messages) {
    for (const pattern of topicPatterns) {
      let match;
      while ((match = pattern.exec(message.content)) !== null) {
        if (match[1] && match[1].length < 50) {
          topics.add(match[1].trim());
        }
      }
    }
  }

  return [...topics].slice(0, 5).join(", ");
}

function extractFacts(content: string): string[] {
  const facts: string[] = [];
  const lines = content.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    // Look for bullet points, numbered lists, or key-value patterns
    if (/^[-•*]/.test(line.trim())) {
      facts.push(line.trim().slice(1).trim().slice(0, 100));
    } else if (/^\d+[.)]\s/.test(line.trim())) {
      facts.push(
        line
          .trim()
          .replace(/^\d+[.)]\s/, "")
          .slice(0, 100),
      );
    } else if (/:\s/.test(line) && line.length < 150) {
      facts.push(line.trim().slice(0, 100));
    }
  }

  return facts.slice(0, 15);
}

function extractConcepts(content: string): string[] {
  // Simple concept extraction - extract key noun phrases
  const words = content.toLowerCase().split(/\s+/);
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "under",
    "again",
    "further",
    "then",
    "once",
    "here",
    "there",
    "when",
    "where",
    "why",
    "how",
    "all",
    "each",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "nor",
    "not",
    "only",
    "own",
    "same",
    "so",
    "than",
    "too",
    "very",
    "just",
    "also",
    "now",
    "and",
    "or",
    "but",
    "if",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "i",
    "you",
    "we",
    "they",
  ]);

  const concepts = words
    .filter((w) => w.length > 3 && !stopWords.has(w) && /^[a-z]+$/.test(w))
    .slice(0, 50);

  // Create bigrams for more meaningful concepts
  const bigrams: string[] = [];
  for (let i = 0; i < concepts.length - 1; i++) {
    bigrams.push(`${concepts[i]} ${concepts[i + 1]}`);
  }

  return [...new Set([...concepts, ...bigrams])];
}

function scoreMessagePriority(message: MessageLike): number {
  let score = 0;

  // System messages are always high priority
  if (message.role === "system") {
    score += 100;
  }

  // Messages with tool calls are important
  if (message.toolCalls && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    score += 50;
  }

  // Messages with decisions are important
  const decisionPatterns = [/decided/i, /will do/i, /going to/i, /plan/i];
  for (const pattern of decisionPatterns) {
    if (pattern.test(message.content)) {
      score += 20;
    }
  }

  // Messages with outcomes are important
  const outcomePatterns = [/success/i, /complet/i, /error/i, /fail/i];
  for (const pattern of outcomePatterns) {
    if (pattern.test(message.content)) {
      score += 15;
    }
  }

  // Penalize very long messages (verbose = lower priority per token)
  const tokens = estimateTokens(message.content);
  if (tokens > 1000) {
    score -= Math.floor(tokens / 500) * 5;
  }

  // Recent messages are higher priority
  if (message.timestamp) {
    const age = Date.now() - message.timestamp;
    const ageMinutes = age / (1000 * 60);
    if (ageMinutes < 5) {
      score += 30;
    } else if (ageMinutes < 30) {
      score += 15;
    }
  }

  return score;
}

function compressMessage(message: MessageLike): MessageLike {
  const facts = extractFacts(message.content);
  const compressedContent =
    facts.length > 0
      ? `[Compressed] ${facts.slice(0, 5).join("; ")}`
      : message.content.slice(0, 200) + "...";

  return {
    ...message,
    content: compressedContent,
    metadata: { ...message.metadata, compressed: true },
  };
}

// ────────────────────────────────────────────────────────────────
// Main Summarization API
// ────────────────────────────────────────────────────────────────

/**
 * Apply summarization strategy to messages
 */
export function summarizeContext(
  messages: MessageLike[],
  strategy: SummarizationStrategy = "hybrid",
  options: SummarizationOptions = {},
): SummarizationResult {
  const startTime = Date.now();
  logger.info(`Applying ${strategy} summarization to ${messages.length} messages`);

  let result: SummarizationResult;

  switch (strategy) {
    case "selective-history":
      result = selectiveHistoryCompression(messages, options);
      break;
    case "fact-extraction":
      result = factExtraction(messages, options);
      break;
    case "semantic-dedup":
      result = semanticDeduplication(messages, options);
      break;
    case "priority-retention":
      result = priorityRetention(messages, options);
      break;
    case "hybrid":
    default:
      result = hybridSummarization(messages, options);
  }

  // Report to context monitor
  const monitor = getContextMonitor();
  monitor.recordSummarizationComplete({
    sessionKey: "current", // Should be passed in
    startTokens: result.originalTokens,
    endTokens: result.resultTokens,
    tokensSaved: result.originalTokens - result.resultTokens,
    compressionRatio: result.compressionRatio,
    summarizationDuration: Date.now() - startTime,
  });

  logger.info(
    `Summarization complete: ${result.originalTokens} → ${result.resultTokens} tokens ` +
      `(${((1 - result.compressionRatio) * 100).toFixed(1)}% reduction)`,
  );

  return result;
}
