/**
 * Skill Domains - Domain-specific knowledge bases
 * Part of AGI 2026 TIER 2: Skill Mastery
 */

// Types
export interface DomainSkill {
  name: string;
  level: number; // 0-10
  examples: string[];
  weaknesses: string[];
}

export interface DomainProfile {
  domain: string;
  skills: DomainSkill[];
  avgLevel: number;
  createdAt: number;
  updatedAt: number;
  strengths: string[];
  areasForImprovement: string[];
}

// Coding domain
export const CODING_DOMAIN: DomainProfile = {
  domain: "software-engineering",
  skills: [
    {
      name: "TypeScript",
      level: 8,
      examples: ["Type-safe async/await", "Generics and constraints", "Decorators"],
      weaknesses: ["Advanced mapped types", "Type inference edge cases"],
    },
    {
      name: "Architecture Patterns",
      level: 7,
      examples: ["MVC/MVP", "Microservices", "Event-driven"],
      weaknesses: ["Large-scale distributed systems", "Real-time sync"],
    },
    {
      name: "Testing",
      level: 6,
      examples: ["Unit tests", "Integration tests", "Mocking"],
      weaknesses: ["Load testing", "Chaos engineering"],
    },
    {
      name: "Performance Optimization",
      level: 7,
      examples: ["Algorithm efficiency", "Memory management", "Caching strategies"],
      weaknesses: ["Hardware-level optimization", "GPU programming"],
    },
    {
      name: "Security",
      level: 6,
      examples: ["Input validation", "Encryption basics", "CORS/auth"],
      weaknesses: ["Advanced cryptography", "Formal security verification"],
    },
  ],
  avgLevel: 6.8,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  strengths: [
    "Clean code principles",
    "Refactoring and code improvement",
    "Debugging methodologies",
    "Version control workflows",
  ],
  areasForImprovement: [
    "Distributed systems coordination",
    "Advanced security hardening",
    "Real-time system design",
    "ML systems implementation",
  ],
};

// Research domain
export const RESEARCH_DOMAIN: DomainProfile = {
  domain: "scientific-research",
  skills: [
    {
      name: "Literature Review",
      level: 7,
      examples: ["Systematic review", "Meta-analysis", "Citation tracking"],
      weaknesses: ["Very recent unpublished work", "Gray literature"],
    },
    {
      name: "Hypothesis Formation",
      level: 6,
      examples: ["Theory-driven hypotheses", "Exploratory hypotheses"],
      weaknesses: ["Novel theoretical frameworks", "Cross-domain synthesis"],
    },
    {
      name: "Experimental Design",
      level: 6,
      examples: ["Control group design", "Randomization", "Statistical power"],
      weaknesses: ["Field experiments", "Longitudinal studies"],
    },
    {
      name: "Data Analysis",
      level: 7,
      examples: ["Statistical tests", "Visualization", "Interpretation"],
      weaknesses: ["Bayesian inference edge cases", "Non-parametric advanced methods"],
    },
    {
      name: "Writing",
      level: 7,
      examples: ["Academic clarity", "Narrative flow", "Citation formatting"],
      weaknesses: ["Prose elegance", "Audience engagement in pop-sci"],
    },
  ],
  avgLevel: 6.6,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  strengths: [
    "Critical thinking",
    "Pattern recognition across domains",
    "Methodological rigor",
    "Knowledge synthesis",
  ],
  areasForImprovement: [
    "Real-world experimental execution",
    "Novel theoretical development",
    "Cross-disciplinary integration",
    "Practical implementation of findings",
  ],
};

// Domain registry
const domains: Map<string, DomainProfile> = new Map([
  ["software-engineering", CODING_DOMAIN],
  ["scientific-research", RESEARCH_DOMAIN],
]);

// Get domain profile
export function getDomain(name: string): DomainProfile | undefined {
  return domains.get(name);
}

// List all domains
export function listDomains(): DomainProfile[] {
  return Array.from(domains.values());
}

// Register new domain
export function registerDomain(profile: DomainProfile): void {
  domains.set(profile.domain, profile);
}

// Update skill level in a domain
export function updateSkillLevel(domain: string, skillName: string, newLevel: number): boolean {
  const domainProfile = domains.get(domain);
  if (!domainProfile) return false;

  const skill = domainProfile.skills.find((s) => s.name === skillName);
  if (!skill) return false;

  skill.level = Math.max(0, Math.min(10, newLevel));
  domainProfile.avgLevel =
    domainProfile.skills.reduce((sum, s) => sum + s.level, 0) / domainProfile.skills.length;
  domainProfile.updatedAt = Date.now();

  return true;
}

// Get recommendation for improvement
export function getImprovementPlan(
  domain: string,
  targetLevel: number = 8,
): {
  skills: Array<{ name: string; current: number; target: number; gap: number }>;
  suggestedFocus: string[];
} {
  const domainProfile = domains.get(domain);
  if (!domainProfile) return { skills: [], suggestedFocus: [] };

  const skills = domainProfile.skills
    .map((s) => ({
      name: s.name,
      current: s.level,
      target: targetLevel,
      gap: Math.max(0, targetLevel - s.level),
    }))
    .sort((a, b) => b.gap - a.gap);

  const suggestedFocus = skills
    .filter((s) => s.gap > 0)
    .slice(0, 3)
    .map((s) => `Improve ${s.name} from ${s.current} to ${s.target} (gap: ${s.gap})`);

  return { skills, suggestedFocus };
}

// Check if expert in domain
export function isExpert(domain: string, threshold: number = 8): boolean {
  const domainProfile = domains.get(domain);
  if (!domainProfile) return false;

  const expertSkills = domainProfile.skills.filter((s) => s.level >= threshold).length;
  return expertSkills >= domainProfile.skills.length * 0.5; // 50%+ skills at threshold
}

// Get domain summary
export function getDomainSummary(domain: string): {
  name: string;
  avgLevel: number;
  expertiseAreas: string[];
  developmentAreas: string[];
  readiness: "beginner" | "intermediate" | "advanced" | "expert";
} {
  const domainProfile = domains.get(domain);
  if (!domainProfile) {
    return {
      name: domain,
      avgLevel: 0,
      expertiseAreas: [],
      developmentAreas: [],
      readiness: "beginner",
    };
  }

  const expertiseAreas = domainProfile.skills
    .filter((s) => s.level >= 7)
    .map((s) => `${s.name} (${s.level}/10)`);

  const developmentAreas = domainProfile.skills
    .filter((s) => s.level < 5)
    .map((s) => `${s.name} (${s.level}/10)`);

  let readiness: "beginner" | "intermediate" | "advanced" | "expert";
  if (domainProfile.avgLevel >= 8) {
    readiness = "expert";
  } else if (domainProfile.avgLevel >= 6) {
    readiness = "advanced";
  } else if (domainProfile.avgLevel >= 4) {
    readiness = "intermediate";
  } else {
    readiness = "beginner";
  }

  return {
    name: domainProfile.domain,
    avgLevel: domainProfile.avgLevel,
    expertiseAreas,
    developmentAreas,
    readiness,
  };
}
