import { describe, expect, it } from "vitest";
import { customizeSynonyms, DEFAULT_SYNONYMS, selectSynonym } from "./synonyms.js";

describe("Synonyms", () => {
  describe("selectSynonym", () => {
    it("should select a synonym from default dictionary", () => {
      const synonym = selectSynonym("START_TOOL");
      expect(synonym).toBeTruthy();
      expect(typeof synonym).toBe("string");
    });

    it("should return empty string for unknown context", () => {
      const synonym = selectSynonym("UNKNOWN_CONTEXT" as any);
      expect(synonym).toBe("");
    });

    it("should use custom dictionary when provided", () => {
      const custom = {
        START_TOOL: [["Custom phrase", 1.0]] as [string, number][],
      };
      const synonym = selectSynonym("START_TOOL", custom as any);
      expect(synonym).toBe("Custom phrase");
    });
  });

  describe("customizeSynonyms", () => {
    it("should merge overrides with base dictionary", () => {
      const overrides = {
        START_TOOL: [["New phrase", 1.0]] as [string, number][],
      };
      const customized = customizeSynonyms(DEFAULT_SYNONYMS, overrides);
      expect(customized.START_TOOL).toEqual(overrides.START_TOOL);
      expect(customized.TOOL_SUCCESS).toEqual(DEFAULT_SYNONYMS.TOOL_SUCCESS);
    });
  });
});
