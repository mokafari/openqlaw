import { z } from "zod";
import { AgentDefaultsSchema } from "./zod-schema.agent-defaults.js";
import { AgentEntrySchema } from "./zod-schema.agent-runtime.js";
import { TranscribeAudioSchema } from "./zod-schema.core.js";

export const ResearchRoleSafetySchema = z
  .object({
    enabled: z.boolean().optional(),
    strictMode: z.boolean().optional(),
  })
  .strict()
  .optional();

export const ResearchTestTimeScalingSchema = z
  .object({
    enabled: z.boolean().optional(),
    maxPaths: z.number().int().positive().optional(),
    qualityTarget: z.number().min(0).max(1).optional(),
    complexityThreshold: z.number().min(0).optional(),
  })
  .strict()
  .optional();

export const ResearchShareFrameworkSchema = z
  .object({
    enabled: z.boolean().optional(),
    logRouting: z.boolean().optional(),
  })
  .strict()
  .optional();

export const ResearchSchema = z
  .object({
    enabled: z.boolean().optional(),
    roleSafety: ResearchRoleSafetySchema,
    testTimeScaling: ResearchTestTimeScalingSchema,
    shareFramework: ResearchShareFrameworkSchema,
  })
  .strict()
  .optional();

export const AgentsSchema = z
  .object({
    defaults: z.lazy(() => AgentDefaultsSchema).optional(),
    list: z.array(AgentEntrySchema).optional(),
    research: ResearchSchema,
  })
  .strict()
  .optional();

export const BindingsSchema = z
  .array(
    z
      .object({
        agentId: z.string(),
        match: z
          .object({
            channel: z.string(),
            accountId: z.string().optional(),
            peer: z
              .object({
                kind: z.union([z.literal("dm"), z.literal("group"), z.literal("channel")]),
                id: z.string(),
              })
              .strict()
              .optional(),
            guildId: z.string().optional(),
            teamId: z.string().optional(),
          })
          .strict(),
      })
      .strict(),
  )
  .optional();

export const BroadcastStrategySchema = z.enum(["parallel", "sequential"]);

export const BroadcastSchema = z
  .object({
    strategy: BroadcastStrategySchema.optional(),
  })
  .catchall(z.array(z.string()))
  .optional();

export const AudioSchema = z
  .object({
    transcription: TranscribeAudioSchema,
  })
  .strict()
  .optional();
