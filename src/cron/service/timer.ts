import type { HeartbeatRunResult } from "../../infra/heartbeat-wake.js";
import type { CronJob } from "../types.js";
import type { CronEvent, CronServiceState } from "./state.js";
import { computeJobNextRunAtMs, nextWakeAtMs, resolveJobPayloadTextForMain } from "./jobs.js";
import { locked } from "./locked.js";
import { ensureLoaded, persist } from "./store.js";

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export function armTimer(state: CronServiceState) {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = null;
  if (!state.deps.cronEnabled) {
    return;
  }
  const nextAt = nextWakeAtMs(state);
  if (!nextAt) {
    return;
  }
  const delay = Math.max(nextAt - state.deps.nowMs(), 0);
  // Avoid TimeoutOverflowWarning when a job is far in the future.
  const clampedDelay = Math.min(delay, MAX_TIMEOUT_MS);
  state.timer = setTimeout(() => {
    void onTimer(state).catch((err) => {
      state.deps.log.error({ err: String(err) }, "cron: timer tick failed");
    });
  }, clampedDelay);
  state.timer.unref?.();
}

export async function onTimer(state: CronServiceState) {
  state.deps.log.error({ ts: new Date().toISOString() }, "🚨 CRON TIMER FIRED");
  if (state.running) {
    return;
  }
  state.running = true;
  try {
    await locked(state, async () => {
      await ensureLoaded(state, { forceReload: true });
      await runDueJobs(state);
      await persist(state);
      armTimer(state);
    });
  } finally {
    state.running = false;
  }
}

export async function runDueJobs(state: CronServiceState) {
  if (!state.store) {
    return;
  }
  const now = state.deps.nowMs();

  // Debug: Log when checking for due jobs
  state.deps.log.info(
    {
      now,
      jobCount: state.store.jobs.length,
      enabledCount: state.store.jobs.filter((j) => j.enabled).length,
    },
    "cron: checking for due jobs",
  );

  const due = state.store.jobs.filter((j) => {
    if (!j.enabled) {
      return false;
    }
    if (typeof j.state.runningAtMs === "number") {
      return false;
    }
    const next = j.state.nextRunAtMs;
    const isDue = typeof next === "number" && now >= next;

    // Debug: Log why jobs aren't due
    if (!isDue && typeof next === "number") {
      state.deps.log.info(
        { job: j.name, next, now, gap: next - now, gapMs: next - now },
        "cron: job not due yet",
      );
    }

    return isDue;
  });

  // Debug: Log how many due jobs found
  state.deps.log.info(
    { dueCount: due.length, dueJobs: due.map((j) => j.name) },
    "cron: found due jobs",
  );

  for (const job of due) {
    await executeJob(state, job, now, { forced: false });
  }
}

export async function executeJob(
  state: CronServiceState,
  job: CronJob,
  nowMs: number,
  opts: { forced: boolean },
) {
  const startedAt = state.deps.nowMs();
  job.state.runningAtMs = startedAt;
  job.state.lastError = undefined;
  emit(state, { jobId: job.id, action: "started", runAtMs: startedAt });

  let deleted = false;

  const finish = async (status: "ok" | "error" | "skipped", err?: string, summary?: string) => {
    const endedAt = state.deps.nowMs();
    job.state.runningAtMs = undefined;
    job.state.lastRunAtMs = startedAt;
    job.state.lastStatus = status;
    job.state.lastDurationMs = Math.max(0, endedAt - startedAt);
    job.state.lastError = err;

    // Track consecutive errors; reset on non-error.
    if (status === "error") {
      job.state.errorCount = (job.state.errorCount ?? 0) + 1;
    } else {
      job.state.errorCount = undefined;
    }

    // Disable one-shot jobs that fail repeatedly to prevent infinite retry loops.
    const maxOneShotRetries = 3;
    const isStuckOneShot =
      job.schedule.kind === "at" &&
      status === "error" &&
      (job.state.errorCount ?? 0) >= maxOneShotRetries;
    if (isStuckOneShot) {
      state.deps.log.warn(
        { jobId: job.id, name: job.name, errorCount: job.state.errorCount },
        "cron: disabling one-shot job after repeated failures",
      );
      job.enabled = false;
      job.state.nextRunAtMs = undefined;
    }

    const shouldDelete =
      job.schedule.kind === "at" && status === "ok" && job.deleteAfterRun === true;

    if (!shouldDelete && !isStuckOneShot) {
      if (job.schedule.kind === "at" && status === "ok") {
        // One-shot job completed successfully; disable it.
        job.enabled = false;
        job.state.nextRunAtMs = undefined;
      } else if (job.enabled) {
        job.state.nextRunAtMs = computeJobNextRunAtMs(job, endedAt);
      } else {
        job.state.nextRunAtMs = undefined;
      }
    }

    emit(state, {
      jobId: job.id,
      action: "finished",
      status,
      error: err,
      summary,
      runAtMs: startedAt,
      durationMs: job.state.lastDurationMs,
      nextRunAtMs: job.state.nextRunAtMs,
    });

    // Camping wake: when a camping cron job fires, exit camping state for the session.
    if (job.metadata?.camping && status === "ok") {
      try {
        const { globalCampingManager } = await import("../../agents/camping.js");
        // Prefer explicit sessionKey from metadata, fall back to agentId, then job id
        const campingSessionId = job.metadata.sessionKey ?? job.agentId ?? job.id;
        const exited = globalCampingManager.exitCamping(campingSessionId);
        if (exited) {
          state.deps.log.info(
            { jobId: job.id, sessionId: campingSessionId },
            "cron: camping job completed, exited camping state",
          );
        }
      } catch (campErr) {
        state.deps.log.warn(
          { jobId: job.id, error: String(campErr) },
          "cron: failed to exit camping state after camping job",
        );
      }
    }

    if (shouldDelete && state.store) {
      state.store.jobs = state.store.jobs.filter((j) => j.id !== job.id);
      deleted = true;
      emit(state, { jobId: job.id, action: "removed" });
    }
  };

  try {
    if (job.sessionTarget === "main") {
      const text = resolveJobPayloadTextForMain(job);
      if (!text) {
        const kind = job.payload.kind;
        await finish(
          "skipped",
          kind === "systemEvent"
            ? "main job requires non-empty systemEvent text"
            : 'main job requires payload.kind="systemEvent"',
        );
        return;
      }
      state.deps.enqueueSystemEvent(text, { agentId: job.agentId });
      if (job.wakeMode === "now" && state.deps.runHeartbeatOnce) {
        const reason = `cron:${job.id}`;
        const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
        const maxWaitMs = 2 * 60_000;
        const waitStartedAt = state.deps.nowMs();

        let heartbeatResult: HeartbeatRunResult;
        for (;;) {
          heartbeatResult = await state.deps.runHeartbeatOnce({ reason });
          if (
            heartbeatResult.status !== "skipped" ||
            heartbeatResult.reason !== "requests-in-flight"
          ) {
            break;
          }
          if (state.deps.nowMs() - waitStartedAt > maxWaitMs) {
            heartbeatResult = {
              status: "skipped",
              reason: "timeout waiting for main lane to become idle",
            };
            break;
          }
          await delay(250);
        }

        if (heartbeatResult.status === "ran") {
          await finish("ok", undefined, text);
        } else if (heartbeatResult.status === "skipped") {
          await finish("skipped", heartbeatResult.reason, text);
        } else {
          await finish("error", heartbeatResult.reason, text);
        }
      } else {
        // wakeMode is "next-heartbeat" or runHeartbeatOnce not available
        state.deps.requestHeartbeatNow({ reason: `cron:${job.id}` });
        await finish("ok", undefined, text);
      }
      return;
    }

    if (job.payload.kind !== "agentTurn") {
      await finish("skipped", "isolated job requires payload.kind=agentTurn");
      return;
    }

    const res = await state.deps.runIsolatedAgentJob({
      job,
      message: job.payload.message,
    });

    // Post a short summary back to the main session so the user sees
    // the cron result without opening the isolated session.
    const summaryText = res.summary?.trim();
    const deliveryMode = job.delivery?.mode ?? "announce";
    if (summaryText && deliveryMode !== "none") {
      const prefix = "Cron";
      const label =
        res.status === "error" ? `${prefix} (error): ${summaryText}` : `${prefix}: ${summaryText}`;
      state.deps.enqueueSystemEvent(label, { agentId: job.agentId });
      if (job.wakeMode === "now") {
        state.deps.requestHeartbeatNow({ reason: `cron:${job.id}` });
      }
    }

    if (res.status === "ok") {
      await finish("ok", undefined, res.summary);
    } else if (res.status === "skipped") {
      await finish("skipped", undefined, res.summary);
    } else {
      await finish("error", res.error ?? "cron job failed", res.summary);
    }
  } catch (err) {
    await finish("error", String(err));
  } finally {
    job.updatedAtMs = nowMs;
    if (!opts.forced && job.enabled && !deleted) {
      // Keep nextRunAtMs in sync in case the schedule advanced during a long run.
      job.state.nextRunAtMs = computeJobNextRunAtMs(job, state.deps.nowMs());
    }
  }
}

export function wake(
  state: CronServiceState,
  opts: { mode: "now" | "next-heartbeat"; text: string },
) {
  const text = opts.text.trim();
  if (!text) {
    return { ok: false } as const;
  }
  state.deps.enqueueSystemEvent(text);
  if (opts.mode === "now") {
    state.deps.requestHeartbeatNow({ reason: "wake" });
  }
  return { ok: true } as const;
}

export function stopTimer(state: CronServiceState) {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = null;
}

export function emit(state: CronServiceState, evt: CronEvent) {
  try {
    state.deps.onEvent?.(evt);
  } catch {
    /* ignore */
  }
}
