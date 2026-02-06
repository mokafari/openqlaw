import type { ChannelId } from "../channels/plugins/types.js";

export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };

export type CronSessionTarget = "main" | "isolated";
export type CronWakeMode = "next-heartbeat" | "now";

export type CronMessageChannel = ChannelId | "last";

export type CronDeliveryMode = "none" | "announce";

export type CronDelivery = {
  mode: CronDeliveryMode;
  channel?: CronMessageChannel;
  to?: string;
  bestEffort?: boolean;
};

export type CronDeliveryPatch = Partial<CronDelivery>;

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | {
      kind: "agentTurn";
      message: string;
      /** Optional model override (provider/model or alias). */
      model?: string;
      thinking?: string;
      timeoutSeconds?: number;
      allowUnsafeExternalContent?: boolean;
      deliver?: boolean;
      channel?: CronMessageChannel;
      to?: string;
      bestEffortDeliver?: boolean;
    };

export type CronPayloadPatch =
  | { kind: "systemEvent"; text?: string }
  | {
      kind: "agentTurn";
      message?: string;
      model?: string;
      thinking?: string;
      timeoutSeconds?: number;
      allowUnsafeExternalContent?: boolean;
      deliver?: boolean;
      channel?: CronMessageChannel;
      to?: string;
      bestEffortDeliver?: boolean;
    };

export type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
  /** Consecutive error count (reset on success). Used to disable stuck one-shot jobs. */
  errorCount?: number;
};

export type CronJobMetadata = {
  condition?: {
    kind: "webhook";
    endpoint: string;
    filter?: Record<string, unknown>;
  };
  camping?: boolean;
  /** Session key for camping wake (used to exit the correct CampingManager entry). */
  sessionKey?: string;
  [key: string]: unknown;
};

export type CronJob = {
  id: string;
  agentId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  delivery?: CronDelivery;
  metadata?: CronJobMetadata;
  state: CronJobState;
};

export type CronStoreFile = {
  version: 1;
  jobs: CronJob[];
};

export type CronJobCreate = Omit<CronJob, "id" | "createdAtMs" | "updatedAtMs" | "state"> & {
  state?: Partial<CronJobState>;
};

export type CronJobPatch = Partial<Omit<CronJob, "id" | "createdAtMs" | "state" | "payload">> & {
  payload?: CronPayloadPatch;
  delivery?: CronDeliveryPatch;
  state?: Partial<CronJobState>;
};
