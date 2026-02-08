/**
 * Abstract Reasoning - Mathematical and logical reasoning hooks
 * Part of AGI 2026 TIER 3: Abstract Reasoning
 */

// Types
export interface ProofStep {
  statement: string;
  justification: string;
  axiomOrRule: string;
}

export interface LogicalProof {
  hypothesis: string;
  conclusion: string;
  steps: ProofStep[];
  isValid: boolean;
  reasoning: string;
}

export interface SymbolicExpression {
  notation: string;
  meaning: string;
  variables: string[];
  complexity: number;
}

export interface MathematicalSystem {
  name: string;
  axioms: string[];
  theorems: string[];
  operations: string[];
}

// Mathematical systems
const SYSTEMS: Map<string, MathematicalSystem> = new Map([
  [
    "logic",
    {
      name: "Propositional Logic",
      axioms: [
        "A ∨ ¬A (Law of Excluded Middle)",
        "¬(A ∧ ¬A) (Law of Non-Contradiction)",
        "A → A (Identity)",
      ],
      theorems: [
        "De Morgan's Laws: ¬(A ∧ B) ≡ ¬A ∨ ¬B",
        "Modus Ponens: (A → B) ∧ A ⊢ B",
        "Transitivity: (A → B) ∧ (B → C) ⊢ (A → C)",
      ],
      operations: ["∧ (AND)", "∨ (OR)", "¬ (NOT)", "→ (IMPLIES)"],
    },
  ],
  [
    "set-theory",
    {
      name: "Set Theory",
      axioms: [
        "Extensionality: Sets are equal iff they have same elements",
        "Foundation: Every set is disjoint from its elements",
        "Infinity: There exists an infinite set",
      ],
      theorems: [
        "De Morgan's Laws for sets",
        "Power set exists for any set",
        "Cantor's theorem: |P(S)| > |S|",
      ],
      operations: ["∪ (Union)", "∩ (Intersection)", "\\ (Difference)", "× (Product)"],
    },
  ],
  [
    "algebra",
    {
      name: "Abstract Algebra",
      axioms: ["Associativity: (a·b)·c = a·(b·c)", "Identity: a·e = e·a = a", "Inverse: a·a⁻¹ = e"],
      theorems: [
        "Cayley's theorem: Every group is isomorphic to permutation group",
        "Lagrange's theorem: |H| divides |G| for subgroup H of G",
        "Fundamental theorem of homomorphisms",
      ],
      operations: ["·", "+", "*", "^"],
    },
  ],
]);

// Symbolic expressions library
const EXPRESSIONS: SymbolicExpression[] = [
  {
    notation: "∀x P(x)",
    meaning: "For all x, P(x) holds",
    variables: ["x"],
    complexity: 2,
  },
  {
    notation: "∃x P(x)",
    meaning: "There exists an x such that P(x)",
    variables: ["x"],
    complexity: 2,
  },
  {
    notation: "A ∈ B",
    meaning: "A is an element of set B",
    variables: ["A", "B"],
    complexity: 1,
  },
  {
    notation: "A ⊆ B",
    meaning: "A is a subset of B",
    variables: ["A", "B"],
    complexity: 1,
  },
  {
    notation: "∑ᵢ₌₁ⁿ aᵢ",
    meaning: "Sum of a from 1 to n",
    variables: ["i", "n", "a"],
    complexity: 3,
  },
  {
    notation: "f: A → B",
    meaning: "Function f from A to B",
    variables: ["f", "A", "B"],
    complexity: 2,
  },
];

// Proof validator
export function validateProof(proof: LogicalProof): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!proof.hypothesis || !proof.conclusion) {
    issues.push("Proof must have hypothesis and conclusion");
  }

  if (proof.steps.length === 0) {
    issues.push("Proof must have at least one step");
  }

  // Check step structure
  for (let i = 0; i < proof.steps.length; i++) {
    const step = proof.steps[i];
    if (!step.statement || !step.justification) {
      issues.push(`Step ${i + 1} missing statement or justification`);
    }
  }

  // Check if conclusion is derivable (simplified check)
  const lastStep = proof.steps[proof.steps.length - 1];
  if (lastStep && !lastStep.statement.includes(proof.conclusion.split(" ")[0])) {
    issues.push("Final step does not appear to derive the conclusion");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// Symbolic reasoning
export function parseSymbol(notation: string): SymbolicExpression | undefined {
  return EXPRESSIONS.find((e) => e.notation === notation);
}

// Symbolic substitution (simple version)
export function substitute(expression: string, variable: string, value: string): string {
  return expression.replace(new RegExp(`\\b${variable}\\b`, "g"), value);
}

// Mathematical system operations
export function getSystem(name: string): MathematicalSystem | undefined {
  return SYSTEMS.get(name);
}

// List systems
export function listSystems(): string[] {
  return Array.from(SYSTEMS.keys());
}

// Register new system
export function registerSystem(system: MathematicalSystem): void {
  SYSTEMS.set(system.name.toLowerCase(), system);
}

// Theorem lookup
export function findTheorem(pattern: string): string[] {
  const results: string[] = [];

  const systemArray: MathematicalSystem[] = [];
  SYSTEMS.forEach((s) => systemArray.push(s));

  for (const system of systemArray) {
    for (const theorem of system.theorems) {
      if (theorem.toLowerCase().includes(pattern.toLowerCase())) {
        results.push(`${system.name}: ${theorem}`);
      }
    }
  }

  return results;
}

// Axiom lookup
export function findAxiom(pattern: string): string[] {
  const results: string[] = [];

  const systemArray: MathematicalSystem[] = [];
  SYSTEMS.forEach((s) => systemArray.push(s));

  for (const system of systemArray) {
    for (const axiom of system.axioms) {
      if (axiom.toLowerCase().includes(pattern.toLowerCase())) {
        results.push(`${system.name}: ${axiom}`);
      }
    }
  }

  return results;
}

// Logical inference (simple forward chaining)
export function inferConclusion(
  premises: string[],
  rule: string,
): { conclusion: string | null; applied: boolean } {
  // Simple pattern matching for Modus Ponens: A → B, A ⊢ B
  if (rule === "modus-ponens" && premises.length >= 2) {
    // Parse "A → B" and "A" to infer "B"
    const implication = premises[0];
    const fact = premises[1];

    if (implication.includes("→")) {
      const [antecedent, consequent] = implication.split("→").map((s) => s.trim());
      if (antecedent === fact) {
        return { conclusion: consequent, applied: true };
      }
    }
  }

  // Simple pattern matching for Hypothetical Syllogism: A → B, B → C ⊢ A → C
  if (rule === "hypothetical-syllogism" && premises.length >= 2) {
    const [rule1, rule2] = premises;

    if (rule1.includes("→") && rule2.includes("→")) {
      const [a, b] = rule1.split("→").map((s) => s.trim());
      const [b2, c] = rule2.split("→").map((s) => s.trim());

      if (b === b2) {
        return { conclusion: `${a} → ${c}`, applied: true };
      }
    }
  }

  return { conclusion: null, applied: false };
}

// Complexity analysis
export function analyzeComplexity(expression: string): {
  complexity: number;
  depth: number;
  operators: string[];
} {
  const operators = ["∀", "∃", "∧", "∨", "¬", "→", "↔", "∈", "⊆", "="];
  const foundOps = operators.filter((op) => expression.includes(op));
  const depth = Math.max(
    ...(expression.match(/[(\[{]/g) || []).map(
      (_, i) => (expression.substring(0, i).match(/[(\[{]/g) || []).length,
    ),
    0,
  );

  return {
    complexity: foundOps.length + depth,
    depth,
    operators: foundOps,
  };
}

// Abstract reasoning exercise
export function generateExercise(
  topic: string,
  difficulty: "easy" | "medium" | "hard",
): { question: string; hint: string; expectedApproach: string } {
  const exercises: Record<string, Record<string, any>> = {
    logic: {
      easy: {
        question: "If all dogs are animals, and Fido is a dog, what can we conclude?",
        hint: "Use modus ponens: all X are Y, Z is X, therefore Z is Y",
        expectedApproach: "Apply categorical syllogism",
      },
      medium: {
        question: "Prove: ¬(A ∧ ¬A)",
        hint: "Use proof by contradiction",
        expectedApproach: "Assume the statement is false and derive contradiction",
      },
      hard: {
        question: "Derive the deduction theorem: A ⊢ B iff ⊢ (A → B)",
        hint: "Use formal proof techniques",
        expectedApproach: "Prove both directions of the biconditional",
      },
    },
    "set-theory": {
      easy: {
        question: "If A = {1, 2, 3} and B = {2, 3, 4}, what is A ∩ B?",
        hint: "Intersection contains elements in both sets",
        expectedApproach: "List common elements",
      },
      medium: {
        question: "Prove De Morgan's law: (A ∪ B)ᶜ = Aᶜ ∩ Bᶜ",
        hint: "Show set equality by element membership",
        expectedApproach: "Use definition of complement and set operations",
      },
      hard: {
        question: "Prove that the power set of any set is larger (by Cantor)",
        hint: "Use diagonalization argument",
        expectedApproach: "Prove bijection cannot exist",
      },
    },
  };

  const topicExercises = exercises[topic];
  if (!topicExercises) {
    return {
      question: `Exercise on ${topic}`,
      hint: "Topic not found in knowledge base",
      expectedApproach: "Research required",
    };
  }

  return topicExercises[difficulty] || topicExercises.easy;
}
