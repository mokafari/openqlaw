/**
 * SOUL.md Loader
 *
 * Loads and parses SOUL.md personality file from workspace root.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { SynonymDictionary } from "./synonyms.js";
import { DEFAULT_SYNONYMS, customizeSynonyms, parseSynonymsFromSoul } from "./synonyms.js";

export type SoulPersonality = {
  content: string;
  synonyms?: SynonymDictionary;
  traits?: string[];
  responseStyle?: "brief" | "detailed" | "conversational";
  lastModified?: number;
};

/**
 * Load SOUL.md from workspace
 */
export async function loadSoul(workspaceDir: string): Promise<SoulPersonality | null> {
  const soulPath = path.join(workspaceDir, "SOUL.md");

  try {
    const content = await fs.readFile(soulPath, "utf-8");
    const stats = await fs.stat(soulPath);

    // Parse synonyms from SOUL.md
    const synonymOverrides = parseSynonymsFromSoul(content);
    const synonyms = synonymOverrides
      ? customizeSynonyms(DEFAULT_SYNONYMS, synonymOverrides)
      : DEFAULT_SYNONYMS;

    // Extract traits (look for ## Traits or similar sections)
    const traits = extractTraits(content);

    // Extract response style
    const responseStyle = extractResponseStyle(content);

    return {
      content,
      synonyms,
      traits,
      responseStyle,
      lastModified: stats.mtimeMs,
    };
  } catch (error) {
    // File doesn't exist or can't be read
    if ((error as { code?: string }).code !== "ENOENT") {
      console.warn(`Failed to load SOUL.md: ${String(error)}`);
    }
    return null;
  }
}

/**
 * Extract personality traits from SOUL.md
 */
function extractTraits(content: string): string[] {
  const traits: string[] = [];

  // Look for traits section
  const traitsMatch = content.match(/##\s*Traits?\s*\n((?:[^\n]+\n?)+)/i);
  if (traitsMatch) {
    const traitsBlock = traitsMatch[1];
    // Extract bullet points or list items
    const traitMatches = traitsBlock.matchAll(/[-*]\s*(.+)/g);
    for (const match of traitMatches) {
      const trait = match[1]?.trim();
      if (trait) {
        traits.push(trait);
      }
    }
  }

  // Also look for keywords in content
  const traitKeywords = [
    "encouraging",
    "cynical",
    "brief",
    "detailed",
    "resilient",
    "cautious",
    "helpful",
    "direct",
  ];

  for (const keyword of traitKeywords) {
    if (content.toLowerCase().includes(keyword) && !traits.includes(keyword)) {
      traits.push(keyword);
    }
  }

  return traits;
}

/**
 * Extract response style from SOUL.md
 */
function extractResponseStyle(content: string): "brief" | "detailed" | "conversational" {
  const lowerContent = content.toLowerCase();

  if (lowerContent.includes("brief") || lowerContent.includes("concise")) {
    return "brief";
  }
  if (lowerContent.includes("detailed") || lowerContent.includes("thorough")) {
    return "detailed";
  }
  return "conversational";
}

/**
 * Check if SOUL.md has changed since last load
 */
export async function hasSoulChanged(
  workspaceDir: string,
  lastModified?: number,
): Promise<boolean> {
  if (!lastModified) {
    return true; // No previous load, consider it changed
  }

  const soulPath = path.join(workspaceDir, "SOUL.md");
  try {
    const stats = await fs.stat(soulPath);
    return stats.mtimeMs > lastModified;
  } catch {
    return false; // File doesn't exist, no change
  }
}
