import { describe, expect, it } from "vitest";
import type { SoulPersonality } from "./soul-loader.js";
import { getTraitForEvent, isLateNight } from "./contextual-triggers.js";

describe("ContextualTriggers", () => {
  describe("getTraitForEvent", () => {
    it("should return default traits when no SOUL.md", () => {
      const traits = getTraitForEvent("BUILD_FAILURE", null);
      expect(traits).toContain("Resilient");
    });

    it("should return encouraging trait for BUILD_FAILURE when SOUL has encouraging", () => {
      const soul: SoulPersonality = {
        content: "",
        traits: ["encouraging"],
      };

      const traits = getTraitForEvent("BUILD_FAILURE", soul);
      expect(traits).toContain("Encouraging");
    });

    it("should return cynical trait for BUILD_FAILURE when SOUL has cynical", () => {
      const soul: SoulPersonality = {
        content: "",
        traits: ["cynical"],
      };

      const traits = getTraitForEvent("BUILD_FAILURE", soul);
      expect(traits).toContain("Cynical");
    });

    it("should return brief trait for LATE_NIGHT", () => {
      const traits = getTraitForEvent("LATE_NIGHT", null);
      expect(traits).toContain("Brief");
    });

    it("should return brief trait for LATE_NIGHT even with SOUL", () => {
      const soul: SoulPersonality = {
        content: "",
        traits: ["detailed"],
      };

      const traits = getTraitForEvent("LATE_NIGHT", soul);
      expect(traits).toContain("Brief");
    });

    it("should return resilient trait for ERROR_RECOVERY", () => {
      const traits = getTraitForEvent("ERROR_RECOVERY", null);
      expect(traits).toContain("Resilient");
    });

    it("should return helpful trait for SUCCESS", () => {
      const traits = getTraitForEvent("SUCCESS", null);
      expect(traits).toContain("Helpful");
    });

    it("should return brief trait for USER_WAITING", () => {
      const traits = getTraitForEvent("USER_WAITING", null);
      expect(traits).toContain("Brief");
    });

    it("should return detailed trait for COMPLEX_TASK when SOUL has detailed", () => {
      const soul: SoulPersonality = {
        content: "",
        traits: ["detailed"],
      };

      const traits = getTraitForEvent("COMPLEX_TASK", soul);
      expect(traits).toContain("Detailed");
    });

    it("should return direct trait for SIMPLE_TASK", () => {
      const traits = getTraitForEvent("SIMPLE_TASK", null);
      expect(traits).toContain("Direct");
    });

    it("should apply response style from SOUL", () => {
      const soul: SoulPersonality = {
        content: "",
        responseStyle: "brief",
      };

      const traits = getTraitForEvent("BUILD_FAILURE", soul);
      expect(traits).toContain("Brief");
    });

    it("should apply detailed response style from SOUL", () => {
      const soul: SoulPersonality = {
        content: "",
        responseStyle: "detailed",
      };

      const traits = getTraitForEvent("SIMPLE_TASK", soul);
      expect(traits).toContain("Detailed");
    });
  });

  describe("isLateNight", () => {
    it("should return true for late night hours (22-23)", () => {
      expect(isLateNight(22)).toBe(true);
      expect(isLateNight(23)).toBe(true);
    });

    it("should return true for early morning hours (0-5)", () => {
      expect(isLateNight(0)).toBe(true);
      expect(isLateNight(5)).toBe(true);
    });

    it("should return false for daytime hours (6-21)", () => {
      expect(isLateNight(6)).toBe(false);
      expect(isLateNight(12)).toBe(false);
      expect(isLateNight(21)).toBe(false);
    });

    it("should use current hour when not provided", () => {
      const result = isLateNight();
      expect(typeof result).toBe("boolean");
    });
  });
});
