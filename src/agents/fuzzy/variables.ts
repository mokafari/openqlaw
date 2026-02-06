/**
 * Fuzzy Variables
 *
 * Defines fuzzy linguistic variables for cognitive economy decisions.
 */

export type FuzzyVariable = {
  name: string;
  range: [number, number]; // [min, max]
  membershipFunctions: MembershipFunction[];
};

export type MembershipFunction = {
  name: string;
  type: "triangular" | "trapezoidal" | "gaussian";
  params: number[]; // Parameters specific to the function type
};

export const CONTEXT_REMAINING: FuzzyVariable = {
  name: "CONTEXT_REMAINING",
  range: [0, 1],
  membershipFunctions: [
    {
      name: "low",
      type: "trapezoidal",
      params: [0, 0, 0.2, 0.3],
    },
    {
      name: "medium",
      type: "triangular",
      params: [0.2, 0.5, 0.8],
    },
    {
      name: "high",
      type: "trapezoidal",
      params: [0.7, 0.8, 1, 1],
    },
  ],
};

export const TASK_COMPLEXITY: FuzzyVariable = {
  name: "TASK_COMPLEXITY",
  range: [0, 1],
  membershipFunctions: [
    {
      name: "simple",
      type: "trapezoidal",
      params: [0, 0, 0.2, 0.3],
    },
    {
      name: "moderate",
      type: "triangular",
      params: [0.2, 0.5, 0.8],
    },
    {
      name: "complex",
      type: "trapezoidal",
      params: [0.7, 0.8, 1, 1],
    },
  ],
};

export const URGENCY: FuzzyVariable = {
  name: "URGENCY",
  range: [0, 1],
  membershipFunctions: [
    {
      name: "low",
      type: "trapezoidal",
      params: [0, 0, 0.3, 0.4],
    },
    {
      name: "medium",
      type: "triangular",
      params: [0.3, 0.5, 0.7],
    },
    {
      name: "high",
      type: "trapezoidal",
      params: [0.6, 0.7, 1, 1],
    },
  ],
};

export const CONFIDENCE: FuzzyVariable = {
  name: "CONFIDENCE",
  range: [0, 1],
  membershipFunctions: [
    {
      name: "low",
      type: "trapezoidal",
      params: [0, 0, 0.3, 0.4],
    },
    {
      name: "medium",
      type: "triangular",
      params: [0.3, 0.5, 0.7],
    },
    {
      name: "high",
      type: "trapezoidal",
      params: [0.6, 0.7, 1, 1],
    },
  ],
};

export function getMembershipValue(
  variable: FuzzyVariable,
  value: number,
  functionName: string,
): number {
  const mf = variable.membershipFunctions.find((f) => f.name === functionName);
  if (!mf) {
    return 0;
  }

  const [min, max] = variable.range;
  const clamped = Math.max(min, Math.min(max, value));

  switch (mf.type) {
    case "triangular": {
      const [a, b, c] = mf.params;
      if (clamped <= a || clamped >= c) {
        return 0;
      }
      if (clamped === b) {
        return 1;
      }
      if (clamped < b) {
        return (clamped - a) / (b - a);
      }
      return (c - clamped) / (c - b);
    }
    case "trapezoidal": {
      const [a, b, c, d] = mf.params;
      if (clamped <= a || clamped >= d) {
        return 0;
      }
      if (clamped >= b && clamped <= c) {
        return 1;
      }
      if (clamped < b) {
        return (clamped - a) / (b - a);
      }
      return (d - clamped) / (d - c);
    }
    case "gaussian": {
      const [center, width] = mf.params;
      return Math.exp(-0.5 * Math.pow((clamped - center) / width, 2));
    }
    default:
      return 0;
  }
}
