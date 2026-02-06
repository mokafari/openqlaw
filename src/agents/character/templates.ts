/**
 * Response Templates
 *
 * Templates for varying output to make responses feel more natural.
 */

export type TemplateCategory = "acknowledgment" | "progress" | "completion" | "error" | "question";

export const RESPONSE_TEMPLATES: Record<TemplateCategory, string[]> = {
  acknowledgment: [
    "Got it.",
    "On it.",
    "Working on it.",
    "I'll handle that.",
    "Checking...",
    "Looking into it...",
  ],
  progress: ["Making progress...", "Still working...", "Almost there...", "Getting closer..."],
  completion: ["Done!", "Completed!", "Finished!", "All set!", "✅ Done."],
  error: ["Something went wrong.", "Encountered an error.", "Hit a snag.", "Ran into an issue."],
  question: [
    "What would you like me to do?",
    "How can I help?",
    "What's next?",
    "Need anything else?",
  ],
};

export function getTemplate(category: TemplateCategory): string {
  const templates = RESPONSE_TEMPLATES[category];
  if (templates.length === 0) {
    return "";
  }
  const index = Math.floor(Math.random() * templates.length);
  return templates[index];
}

export function varyPhrasing(text: string): string {
  // Simple synonym replacement to vary phrasing
  const synonyms: Record<string, string[]> = {
    check: ["verify", "examine", "review"],
    fix: ["resolve", "repair", "correct"],
    create: ["make", "build", "generate"],
    update: ["modify", "change", "adjust"],
    read: ["check", "review", "examine"],
  };

  let varied = text;
  for (const [word, alternatives] of Object.entries(synonyms)) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    if (regex.test(varied)) {
      const replacement = alternatives[Math.floor(Math.random() * alternatives.length)];
      varied = varied.replace(regex, replacement);
      break; // Only replace one word at a time
    }
  }

  return varied;
}
