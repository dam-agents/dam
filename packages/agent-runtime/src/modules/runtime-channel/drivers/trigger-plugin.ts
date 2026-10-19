import type {
  DriverBinding,
  EventContext,
  EventHandler,
  EventOutcome,
  EventReportInput,
  Plugin,
  ScheduleResetEventPayload,
  TriggerEventPayload,
} from "agent-runtime-api";
import { INVOCATION_SCHEDULE_PREFIX } from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";
import {
  SessionModelError,
  type TriggerSessionDriver,
} from "../../acp/index.js";
import type { PrecheckOutcome } from "../domain/precheck.js";
import type { PrecheckRunner } from "../infrastructure/precheck-runner.js";
import type { TriggerStateStore } from "../infrastructure/trigger-state-store.js";
import type { InvocationWatch } from "../invocation-watch.js";

const IMPL_NAME = "trigger";

export interface EventReporter {
  report(input: EventReportInput): Promise<void>;
}

const DETAIL_MAX = 2_000;

const WIRE_OUTCOME: Record<PrecheckOutcome["verdict"], EventOutcome> = {
  allowed: "ok",
  declined: "declined",
  "precheck-failed": "failed",
};

function continuationPrompt(name: string, task: string): string {
  return `[One-time task "${name}", scheduled from this session, is due now]\n\n${task}`;
}

function sessionTypeOf(payload: TriggerEventPayload): SessionType {
  if (payload.invocation) return SessionType.Invocation;
  return payload.once ? SessionType.ScheduleOnce : SessionType.ScheduleCron;
}

function withContext(task: string, context: string | undefined): string {
  return context ? `${task}\n\n---\nPrecheck output:\n${context}` : task;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: how long a trigger waits for the model
 * catalog's first listing on a fresh pod, where the env rail and the trigger
 * arrive together: a harness process spawned before the listing gets no
 * tier models. The wait is bounded so a provider outage never holds a run.
 */
const CATALOG_WAIT_MS = 10_000;

const START_ATTEMPTS = 3;
const START_RETRY_MS = 5_000;

export function createTriggerPlugin(deps: {
  driver: TriggerSessionDriver;
  stateStore: TriggerStateStore;
  runPrecheck: PrecheckRunner;
  log: (msg: string) => void;
  reporter: EventReporter;
  findSessionByRef?: (ref: string) => string | undefined;
  catalogListed?: () => Promise<void>;
  invocationWatch?: Pick<InvocationWatch, "watch">;
}): Plugin {
  const startSession = async (
    payload: TriggerEventPayload,
    task: string,
  ): Promise<string> => {
    if (deps.catalogListed)
      await Promise.race([
        deps.catalogListed(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, CATALOG_WAIT_MS).unref?.();
        }),
      ]);
    const model = payload.model;
    const platformMeta = {
      type: sessionTypeOf(payload),
      mode: SessionMode.Chat,
      scheduleId: payload.scheduleId,
      ...(payload.harness !== undefined && { harness: payload.harness }),
      ...(payload.provider !== undefined && { provider: payload.provider }),
      ...(model !== undefined && { model }),
      ...(payload.sessionTitle && { customTitle: payload.sessionTitle }),
      ...(payload.settings !== undefined && { settings: payload.settings }),
    };
    const origin = payload.origin;
    if (origin?.mode === "continue") {
      const originSession = deps.findSessionByRef?.(origin.sessionRef);
      if (originSession) {
        const res = await deps.driver.start({
          task: continuationPrompt(origin.name, task),
          mcpServers: payload.mcpServers,
          resumeSessionId: originSession,
          unattended: true,
        });
        return res.sessionId;
      }
      deps.log(
        `[trigger] ${payload.scheduleId}: the session that scheduled it is gone; running in a fresh session`,
      );
    }
    if (origin?.mode === "report") {
      const res = await deps.driver.start({
        task,
        mcpServers: payload.mcpServers,
        platformMeta: {
          ...platformMeta,
          reportTo: origin.sessionRef,
          reportName: origin.name,
        },
        model,
      });
      return res.sessionId;
    }
    if (!payload.once && (payload.sessionMode ?? "fresh") === "continuous") {
      const prior = deps.stateStore.getSessionForSchedule(payload.scheduleId);
      const res = await deps.driver
        .start({
          task,
          mcpServers: payload.mcpServers,
          ...(prior ? { resumeSessionId: prior } : { platformMeta }),
          model,
        })
        .catch((err: unknown) => {
          if (!prior && err instanceof SessionModelError && err.sessionId)
            deps.stateStore.setSessionForSchedule(
              payload.scheduleId,
              err.sessionId,
            );
          throw err;
        });
      if (!prior)
        deps.stateStore.setSessionForSchedule(
          payload.scheduleId,
          res.sessionId,
        );
      return res.sessionId;
    }
    const res = await deps.driver.start({
      task,
      mcpServers: payload.mcpServers,
      platformMeta,
      model,
    });
    return res.sessionId;
  };

  const report = async (input: EventReportInput): Promise<void> => {
    try {
      await deps.reporter.report(input);
    } catch (err) {
      deps.log(`[trigger] event report failed: ${(err as Error).message}`);
    }
  };

  const refusedReport = (
    eventId: string,
    detail: string,
  ): EventReportInput => ({ eventId, outcome: "failed", stage: "run", detail });

  const runOrRefuse = async (
    payload: TriggerEventPayload,
    task: string,
  ): Promise<string | null> => {
    try {
      await startSession(payload, task);
      return null;
    } catch (err) {
      if (!(err instanceof SessionModelError)) throw err;
      deps.log(`[trigger] ${payload.scheduleId} not run: ${err.message}`);
      return err.message.slice(0, DETAIL_MAX);
    }
  };

  const runOrFail = async (
    payload: TriggerEventPayload,
    task: string,
  ): Promise<string | null> => {
    try {
      return await runOrRefuse(payload, task);
    } catch (err) {
      const detail = `the run could not start: ${(err as Error).message}`;
      deps.log(`[trigger] ${payload.scheduleId} ${detail}`);
      return detail.slice(0, DETAIL_MAX);
    }
  };

  const decideAndRun = async (
    payload: TriggerEventPayload,
    precheck: string,
    eventId: string,
  ): Promise<void> => {
    const outcome = await deps.runPrecheck({
      command: precheck,
      scheduleId: payload.scheduleId,
      ...(payload.fireAt ? { fireAt: payload.fireAt } : {}),
      ...(payload.lastRunAt ? { lastRunAt: payload.lastRunAt } : {}),
    });
    deps.log(
      `[precheck] ${payload.scheduleId} ${outcome.verdict}${outcome.detail ? `: ${outcome.detail}` : ""}`,
    );
    const refused =
      outcome.verdict === "declined"
        ? null
        : await runOrFail(payload, withContext(payload.task, outcome.context));
    await report(
      refused
        ? refusedReport(eventId, refused)
        : {
            eventId,
            outcome: WIRE_OUTCOME[outcome.verdict],
            ...(outcome.detail ? { detail: outcome.detail } : {}),
          },
    );
  };

  const runInvocation = async (
    payload: TriggerEventPayload,
    eventId: string,
  ): Promise<void> => {
    for (let attempt = 1; ; attempt++) {
      try {
        deps.invocationWatch?.watch(
          await startSession(payload, payload.task),
          eventId,
        );
        return;
      } catch (err) {
        if (err instanceof SessionModelError || attempt >= START_ATTEMPTS) {
          failInvocation(payload, eventId, err);
          return;
        }
        deps.log(
          `[trigger] ${payload.scheduleId} start attempt ${attempt} failed: ${(err as Error).message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, START_RETRY_MS));
      }
    }
  };

  const failInvocation = (
    payload: TriggerEventPayload,
    eventId: string,
    err: unknown,
  ): void => {
    const detail =
      err instanceof SessionModelError
        ? err.message
        : `the run could not start: ${(err as Error).message}`;
    deps.log(`[trigger] ${payload.scheduleId} ${detail}`);
    void report(refusedReport(eventId, detail.slice(0, DETAIL_MAX)));
  };

  const fire = async (
    payload: TriggerEventPayload,
    ctx: EventContext,
  ): Promise<void> => {
    if (payload.scheduleId.startsWith(INVOCATION_SCHEDULE_PREFIX)) {
      await runInvocation(payload, ctx.eventId);
      return;
    }
    if (!payload.precheck) {
      const refused = await runOrRefuse(payload, payload.task);
      if (refused) void report(refusedReport(ctx.eventId, refused));
      return;
    }
    void decideAndRun(payload, payload.precheck, ctx.eventId).catch((err) =>
      deps.log(`[trigger] precheck run failed: ${(err as Error).message}`),
    );
  };

  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind === "trigger") {
        return async (payload, ctx) =>
          fire(payload as TriggerEventPayload, ctx);
      }
      if (kind === "schedule-reset") {
        return async (payload) =>
          deps.stateStore.clearSessionForSchedule(
            (payload as ScheduleResetEventPayload).scheduleId,
          );
      }
      throw new Error(
        `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
      );
    },
  };
}
