/**
 * Tool Output Formatter with Synonyms
 *
 * Formats tool execution messages using synonym dictionary for
 * natural variation.
 */

import type { SynonymContext, SynonymDictionary } from "./synonyms.js";
import { selectSynonym } from "./synonyms.js";

export type ToolOutputFormatterOptions = {
  synonymDictionary?: SynonymDictionary;
  useSynonyms?: boolean;
};

/**
 * Format tool start message
 */
export function formatToolStart(
  toolName: string,
  options: ToolOutputFormatterOptions = {},
): string {
  if (options.useSynonyms !== false && options.synonymDictionary) {
    const synonym = selectSynonym("START_TOOL", options.synonymDictionary);
    if (synonym) {
      return `${synonym} Running ${toolName}...`;
    }
  }
  return `Running ${toolName}...`;
}

/**
 * Format tool success message
 */
export function formatToolSuccess(
  toolName: string,
  options: ToolOutputFormatterOptions = {},
): string {
  if (options.useSynonyms !== false && options.synonymDictionary) {
    const synonym = selectSynonym("TOOL_SUCCESS", options.synonymDictionary);
    if (synonym) {
      return `${synonym} ${toolName} completed successfully.`;
    }
  }
  return `${toolName} completed successfully.`;
}

/**
 * Format tool error message
 */
export function formatToolError(
  toolName: string,
  error: string,
  options: ToolOutputFormatterOptions = {},
): string {
  if (options.useSynonyms !== false && options.synonymDictionary) {
    const synonym = selectSynonym("TOOL_ERROR", options.synonymDictionary);
    if (synonym) {
      return `${synonym} ${toolName} failed: ${error}`;
    }
  }
  return `${toolName} failed: ${error}`;
}

/**
 * Format planning message
 */
export function formatPlanning(message: string, options: ToolOutputFormatterOptions = {}): string {
  if (options.useSynonyms !== false && options.synonymDictionary) {
    const synonym = selectSynonym("PLANNING", options.synonymDictionary);
    if (synonym) {
      return `${synonym} ${message}`;
    }
  }
  return message;
}

/**
 * Format waiting message
 */
export function formatWaiting(message: string, options: ToolOutputFormatterOptions = {}): string {
  if (options.useSynonyms !== false && options.synonymDictionary) {
    const synonym = selectSynonym("WAITING", options.synonymDictionary);
    if (synonym) {
      return `${synonym} ${message}`;
    }
  }
  return message;
}

/**
 * Format completion message
 */
export function formatCompleted(message: string, options: ToolOutputFormatterOptions = {}): string {
  if (options.useSynonyms !== false && options.synonymDictionary) {
    const synonym = selectSynonym("COMPLETED", options.synonymDictionary);
    if (synonym) {
      return `${synonym} ${message}`;
    }
  }
  return message;
}
