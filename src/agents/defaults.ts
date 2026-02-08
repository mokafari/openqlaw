// Defaults for agent metadata when upstream does not supply them.
// Model id uses pi-ai's built-in Anthropic catalog.
export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-opus-4-5";
// Context window: Opus 4.5 supports ~200k tokens (per pi-ai models.generated.ts).
// Reserve 5k tokens as safety margin — token estimation can undercount, causing
// "prompt is too long" 400 errors when the effective prompt barely exceeds the limit.
export const DEFAULT_CONTEXT_TOKENS = 195_000;
