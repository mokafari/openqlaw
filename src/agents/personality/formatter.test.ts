import { describe, expect, it } from "vitest";
import {
  formatCompleted,
  formatPlanning,
  formatToolError,
  formatToolStart,
  formatToolSuccess,
  formatWaiting,
} from "./formatter.js";
import { DEFAULT_SYNONYMS } from "./synonyms.js";

describe("ToolOutputFormatter", () => {
  describe("formatToolStart", () => {
    it("should format tool start without synonyms", () => {
      const result = formatToolStart("read", { useSynonyms: false });
      expect(result).toBe("Running read...");
    });

    it("should format tool start with synonyms", () => {
      const result = formatToolStart("read", {
        synonymDictionary: DEFAULT_SYNONYMS,
        useSynonyms: true,
      });
      expect(result).toMatch(/^(On it|Checking that now|Scanning\.\.\.) Running read\.\.\.$/);
    });

    it("should default to using synonyms when dictionary provided", () => {
      const result = formatToolStart("read", {
        synonymDictionary: DEFAULT_SYNONYMS,
      });
      expect(result).toMatch(/Running read\.\.\./);
    });
  });

  describe("formatToolSuccess", () => {
    it("should format tool success without synonyms", () => {
      const result = formatToolSuccess("read", { useSynonyms: false });
      expect(result).toBe("read completed successfully.");
    });

    it("should format tool success with synonyms", () => {
      const result = formatToolSuccess("read", {
        synonymDictionary: DEFAULT_SYNONYMS,
        useSynonyms: true,
      });
      expect(result).toMatch(/^(Done\.|Task complete\.|Got it\.) read completed successfully\.$/);
    });
  });

  describe("formatToolError", () => {
    it("should format tool error without synonyms", () => {
      const result = formatToolError("read", "File not found", { useSynonyms: false });
      expect(result).toBe("read failed: File not found");
    });

    it("should format tool error with synonyms", () => {
      const result = formatToolError("read", "File not found", {
        synonymDictionary: DEFAULT_SYNONYMS,
        useSynonyms: true,
      });
      expect(result).toMatch(/read failed: File not found/);
      expect(result).toMatch(
        /^(Hmm, that didn't work\.|Let me try a different approach\.|That failed, trying again\.)/,
      );
    });
  });

  describe("formatPlanning", () => {
    it("should format planning message without synonyms", () => {
      const result = formatPlanning("Planning deployment", { useSynonyms: false });
      expect(result).toBe("Planning deployment");
    });

    it("should format planning message with synonyms", () => {
      const result = formatPlanning("deployment", {
        synonymDictionary: DEFAULT_SYNONYMS,
        useSynonyms: true,
      });
      expect(result).toMatch(
        /^(Planning the approach\.\.\.|Figuring out the best way\.\.\.|Working on a plan\.\.\.) deployment$/,
      );
    });
  });

  describe("formatWaiting", () => {
    it("should format waiting message without synonyms", () => {
      const result = formatWaiting("Waiting for build", { useSynonyms: false });
      expect(result).toBe("Waiting for build");
    });

    it("should format waiting message with synonyms", () => {
      const result = formatWaiting("build", {
        synonymDictionary: DEFAULT_SYNONYMS,
        useSynonyms: true,
      });
      expect(result).toMatch(
        /^(Waiting for that to finish\.\.\.|Let me check back in a moment\.|Standing by\.\.\.) build$/,
      );
    });
  });

  describe("formatCompleted", () => {
    it("should format completed message without synonyms", () => {
      const result = formatCompleted("Task done", { useSynonyms: false });
      expect(result).toBe("Task done");
    });

    it("should format completed message with synonyms", () => {
      const result = formatCompleted("deployment", {
        synonymDictionary: DEFAULT_SYNONYMS,
        useSynonyms: true,
      });
      expect(result).toMatch(/^(All done!|Finished\.|Complete\.) deployment$/);
    });
  });
});
