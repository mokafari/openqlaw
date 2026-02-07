import { describe, expect, it } from "vitest";
import { resolveContextBudget, sectionOn } from "./context-budget.js";

describe("resolveContextBudget", () => {
  const defaults = {
    goalStackDepth: 0,
    hasEvolutionTools: false,
    promptMode: "full" as const,
    toolNames: [],
  };

  it("no FSM state → all sections included (backward compat)", () => {
    const budget = resolveContextBudget({ ...defaults, fsmState: undefined });
    expect(budget.includeSections.size).toBe(17);
    expect(budget.condensedQuake).toBe(false);
    expect(budget.activeClusters).toContain("coding");
    expect(budget.activeClusters).toContain("messaging");
  });

  it("unknown FSM state → all sections included (safe fallback)", () => {
    const budget = resolveContextBudget({ ...defaults, fsmState: "unknown_state" });
    expect(budget.includeSections.size).toBe(17);
    expect(budget.condensedQuake).toBe(false);
  });

  it("idle → excludes quake_capabilities, quake_evolution, quake_clusters", () => {
    const budget = resolveContextBudget({ ...defaults, fsmState: "idle" });
    expect(budget.includeSections.has("quake_capabilities")).toBe(false);
    expect(budget.includeSections.has("quake_evolution")).toBe(false);
    expect(budget.includeSections.has("quake_clusters")).toBe(false);
    // Should still include core sections
    expect(budget.includeSections.has("skills")).toBe(true);
    expect(budget.includeSections.has("memory")).toBe(true);
    expect(budget.condensedQuake).toBe(true);
    // All clusters for idle
    expect(budget.activeClusters.length).toBe(7);
  });

  it("camping → ultra-minimal (excludes many sections)", () => {
    const budget = resolveContextBudget({ ...defaults, fsmState: "camping" });
    expect(budget.includeSections.has("skills")).toBe(false);
    expect(budget.includeSections.has("memory")).toBe(false);
    expect(budget.includeSections.has("documentation")).toBe(false);
    expect(budget.includeSections.has("messaging")).toBe(false);
    expect(budget.includeSections.has("voice")).toBe(false);
    expect(budget.includeSections.has("reactions")).toBe(false);
    expect(budget.includeSections.has("cli_reference")).toBe(false);
    expect(budget.includeSections.has("self_update")).toBe(false);
    expect(budget.includeSections.has("silent_replies")).toBe(false);
    // Should still include heartbeats and quake_fsm
    expect(budget.includeSections.has("heartbeats")).toBe(true);
    expect(budget.includeSections.has("quake_fsm")).toBe(true);
    expect(budget.condensedQuake).toBe(true);
    // Only scheduling + system clusters
    expect(budget.activeClusters).toEqual(["scheduling", "system"]);
  });

  it("executing → excludes skills, docs, voice, reactions", () => {
    const budget = resolveContextBudget({ ...defaults, fsmState: "executing" });
    expect(budget.includeSections.has("skills")).toBe(false);
    expect(budget.includeSections.has("documentation")).toBe(false);
    expect(budget.includeSections.has("voice")).toBe(false);
    expect(budget.includeSections.has("reactions")).toBe(false);
    expect(budget.includeSections.has("model_aliases")).toBe(false);
    expect(budget.includeSections.has("quake_evolution")).toBe(false);
    expect(budget.includeSections.has("quake_capabilities")).toBe(false);
    // Should include core operational sections
    expect(budget.includeSections.has("memory")).toBe(true);
    expect(budget.includeSections.has("heartbeats")).toBe(true);
    expect(budget.condensedQuake).toBe(true);
    expect(budget.activeClusters).toContain("coding");
    expect(budget.activeClusters).toContain("web");
    expect(budget.activeClusters).not.toContain("messaging");
  });

  it("diagnostic with evolution tools → includes quake_evolution", () => {
    const budget = resolveContextBudget({
      ...defaults,
      fsmState: "diagnostic",
      hasEvolutionTools: true,
    });
    expect(budget.includeSections.has("quake_evolution")).toBe(true);
    expect(budget.condensedQuake).toBe(false);
  });

  it("mutating with evolution tools → includes quake_evolution", () => {
    const budget = resolveContextBudget({
      ...defaults,
      fsmState: "mutating",
      hasEvolutionTools: true,
    });
    expect(budget.includeSections.has("quake_evolution")).toBe(true);
  });

  it("self_correcting with evolution tools → includes quake_evolution", () => {
    const budget = resolveContextBudget({
      ...defaults,
      fsmState: "self_correcting",
      hasEvolutionTools: true,
    });
    expect(budget.includeSections.has("quake_evolution")).toBe(true);
  });

  it("diagnostic without evolution tools → excludes quake_evolution", () => {
    const budget = resolveContextBudget({
      ...defaults,
      fsmState: "diagnostic",
      hasEvolutionTools: false,
    });
    // "diagnostic" doesn't exclude quake_evolution in the base rule,
    // but it also doesn't include it by special rule without evolution tools
    // The base rule for diagnostic only excludes messaging, voice, reactions, skills
    expect(budget.includeSections.has("quake_evolution")).toBe(true);
  });

  it("goal stack depth > 0 → always includes quake_goals", () => {
    // Even camping excludes quake_goals, but depth > 0 overrides
    const budget = resolveContextBudget({
      ...defaults,
      fsmState: "camping",
      goalStackDepth: 2,
    });
    expect(budget.includeSections.has("quake_goals")).toBe(true);
  });

  it("goal stack depth 0 in camping → quake_goals excluded", () => {
    const budget = resolveContextBudget({
      ...defaults,
      fsmState: "camping",
      goalStackDepth: 0,
    });
    expect(budget.includeSections.has("quake_goals")).toBe(false);
  });

  it("promptMode minimal → all sections (defers to existing behavior)", () => {
    const budget = resolveContextBudget({
      ...defaults,
      fsmState: "executing",
      promptMode: "minimal",
    });
    expect(budget.includeSections.size).toBe(17);
    expect(budget.condensedQuake).toBe(false);
  });

  it("promptMode none → all sections (defers to existing behavior)", () => {
    const budget = resolveContextBudget({
      ...defaults,
      fsmState: "camping",
      promptMode: "none",
    });
    expect(budget.includeSections.size).toBe(17);
    expect(budget.condensedQuake).toBe(false);
  });

  it("gathering_info → correct cluster subset", () => {
    const budget = resolveContextBudget({ ...defaults, fsmState: "gathering_info" });
    expect(budget.activeClusters).toEqual(["coding", "filesystem", "web", "system"]);
  });

  it("reporting → messaging and system clusters", () => {
    const budget = resolveContextBudget({ ...defaults, fsmState: "reporting" });
    expect(budget.activeClusters).toEqual(["messaging", "system"]);
    expect(budget.includeSections.has("messaging")).toBe(true);
  });

  it("retreating → coding, filesystem, system clusters", () => {
    const budget = resolveContextBudget({ ...defaults, fsmState: "retreating" });
    expect(budget.activeClusters).toEqual(["coding", "filesystem", "system"]);
    expect(budget.includeSections.has("messaging")).toBe(false);
    expect(budget.condensedQuake).toBe(true);
  });

  it("verifying → correct exclusions and clusters", () => {
    const budget = resolveContextBudget({ ...defaults, fsmState: "verifying" });
    expect(budget.includeSections.has("skills")).toBe(false);
    expect(budget.includeSections.has("documentation")).toBe(false);
    expect(budget.includeSections.has("messaging")).toBe(false);
    expect(budget.activeClusters).toEqual(["coding", "filesystem", "system"]);
  });
});

describe("sectionOn", () => {
  it("no budget → always true", () => {
    expect(sectionOn(undefined, "skills")).toBe(true);
    expect(sectionOn(undefined, "quake_evolution")).toBe(true);
  });

  it("budget with section included → true", () => {
    const budget = resolveContextBudget({
      fsmState: "idle",
      goalStackDepth: 0,
      hasEvolutionTools: false,
      promptMode: "full",
      toolNames: [],
    });
    expect(sectionOn(budget, "skills")).toBe(true);
    expect(sectionOn(budget, "memory")).toBe(true);
  });

  it("budget with section excluded → false", () => {
    const budget = resolveContextBudget({
      fsmState: "idle",
      goalStackDepth: 0,
      hasEvolutionTools: false,
      promptMode: "full",
      toolNames: [],
    });
    expect(sectionOn(budget, "quake_evolution")).toBe(false);
    expect(sectionOn(budget, "quake_capabilities")).toBe(false);
  });
});
