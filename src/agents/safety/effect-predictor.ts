/**
 * Effect Predictor - Predict and prevent dangerous tool effects
 * Part of AGI 2026 TIER 1: Safety Constraints
 */

// Types
export interface ToolEffect {
  kind: "read" | "write" | "delete" | "execute" | "network" | "system";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  reversible: boolean;
  affectedResources: string[];
}

export interface PredictionResult {
  tool: string;
  safe: boolean;
  effects: ToolEffect[];
  riskScore: number; // 0-1, higher = more dangerous
  recommendation: "allow" | "caution" | "block";
  reason: string;
}

// Dangerous patterns
const DANGEROUS_PATTERNS = {
  exec: [
    /rm\s+-rf/,
    /mkfs/,
    /dd\s+of=/,
    /sudo/,
    /chmod\s+777/,
    /chown/,
    /reboot/,
    /shutdown/,
    /killall/,
    /pkill/,
    /kill\s+-9/,
  ],
  write: [/\/etc\//, /\/System\//, /\/Applications/, /\.plist/i],
  delete: [/\/[a-z]+\/\*/, /\.\.\//],
};

// Tool-specific effect predictors
const toolPredictor: Record<string, (params: Record<string, any>) => ToolEffect[]> = {
  exec: (params) => {
    const cmd = String(params.command || "");
    const effects: ToolEffect[] = [];

    // Check dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS.exec) {
      if (pattern.test(cmd)) {
        effects.push({
          kind: "execute",
          severity: "critical",
          description: `Dangerous command pattern detected: ${cmd.slice(0, 50)}`,
          reversible: false,
          affectedResources: ["system"],
        });
      }
    }

    // General effects
    if (cmd.includes("rm ")) {
      effects.push({
        kind: "delete",
        severity: "high",
        description: "File deletion detected",
        reversible: false,
        affectedResources: ["filesystem"],
      });
    }

    if (cmd.includes("git push")) {
      effects.push({
        kind: "network",
        severity: "medium",
        description: "Git repository push",
        reversible: true,
        affectedResources: ["repository"],
      });
    }

    return effects;
  },

  write: (params) => {
    const path = String(params.file_path || params.path || "");
    const effects: ToolEffect[] = [];

    // Check dangerous paths
    for (const pattern of DANGEROUS_PATTERNS.write) {
      if (pattern.test(path)) {
        effects.push({
          kind: "write",
          severity: "critical",
          description: `System file write detected: ${path}`,
          reversible: false,
          affectedResources: ["system"],
        });
      }
    }

    effects.push({
      kind: "write",
      severity: "low",
      description: `Writing to ${path}`,
      reversible: true,
      affectedResources: [path],
    });

    return effects;
  },

  edit: (params) => {
    const path = String(params.file_path || "");
    const effects: ToolEffect[] = [];

    if (DANGEROUS_PATTERNS.write.some((p) => p.test(path))) {
      effects.push({
        kind: "write",
        severity: "critical",
        description: `System file edit detected: ${path}`,
        reversible: false,
        affectedResources: ["system"],
      });
    }

    effects.push({
      kind: "write",
      severity: "low",
      description: `Editing ${path}`,
      reversible: true,
      affectedResources: [path],
    });

    return effects;
  },

  browser: (params) => [
    {
      kind: "network",
      severity: "low",
      description: "Browser action",
      reversible: true,
      affectedResources: ["web"],
    },
  ],

  web_fetch: (params) => [
    {
      kind: "network",
      severity: "low",
      description: "Web request",
      reversible: true,
      affectedResources: ["web"],
    },
  ],

  message: (params) => [
    {
      kind: "network",
      severity: "medium",
      description: "Message send",
      reversible: true,
      affectedResources: ["communication"],
    },
  ],

  sessions_spawn: (params) => [
    {
      kind: "execute",
      severity: "medium",
      description: "Spawning new agent session",
      reversible: true,
      affectedResources: ["agent"],
    },
  ],
};

// Predict effects of a tool call
export function predictEffects(tool: string, params: Record<string, any> = {}): PredictionResult {
  const predictor = toolPredictor[tool];
  const effects = predictor ? predictor(params) : [];

  // Calculate risk score
  const severityWeights = { low: 0.1, medium: 0.3, high: 0.7, critical: 1.0 };
  const avgRisk =
    effects.length > 0
      ? effects.reduce((sum, e) => sum + (severityWeights[e.severity] || 0), 0) / effects.length
      : 0;

  const riskScore = Math.min(1, avgRisk);

  // Determine safety
  const hasCritical = effects.some((e) => e.severity === "critical");
  const safe = !hasCritical && riskScore < 0.7;

  // Recommendation
  let recommendation: "allow" | "caution" | "block";
  if (hasCritical) {
    recommendation = "block";
  } else if (riskScore > 0.5) {
    recommendation = "caution";
  } else {
    recommendation = "allow";
  }

  const reason = hasCritical
    ? `Critical risk: ${effects.find((e) => e.severity === "critical")?.description}`
    : riskScore > 0.5
      ? `High risk detected (score: ${riskScore.toFixed(2)})`
      : `Safe to execute`;

  return {
    tool,
    safe,
    effects,
    riskScore,
    recommendation,
    reason,
  };
}

// Check if a tool call should be blocked
export function shouldBlock(tool: string, params: Record<string, any> = {}): boolean {
  const prediction = predictEffects(tool, params);
  return prediction.recommendation === "block";
}

// Get safety summary
export function getSafetySummary(predictions: PredictionResult[]): {
  safeCount: number;
  cautionCount: number;
  blockedCount: number;
  avgRisk: number;
} {
  const safe = predictions.filter((p) => p.recommendation === "allow").length;
  const caution = predictions.filter((p) => p.recommendation === "caution").length;
  const blocked = predictions.filter((p) => p.recommendation === "block").length;
  const avgRisk =
    predictions.length > 0
      ? predictions.reduce((sum, p) => sum + p.riskScore, 0) / predictions.length
      : 0;

  return { safeCount: safe, cautionCount: caution, blockedCount: blocked, avgRisk };
}
