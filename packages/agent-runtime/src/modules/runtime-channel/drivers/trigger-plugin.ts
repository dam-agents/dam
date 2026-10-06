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
import { SessionMode, SessionType } from "api-server-api";
import {
  SessionModelError,
  type TriggerSessionDriver,
} from "../../acp/index.js";
import type { PrecheckOutcome } from "../domain/precheck.js";
import type { PrecheckRunner } from "../infrastructure/precheck-runner.js";
import type { TriggerStateStore } from "../infrastructure/trigger-state-store.js";

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

function withContext(task: string, context: string | undefined): string {
  return context ? `${task}\n\n---\nPrecheck output:\n${context}` : task;
}

export function createTriggerPlugin(deps: {
  driver: TriggerSessionDriver;
  stateStore: TriggerStateStore;
  configuredModel: () => Promise<string | null>;
  runPrecheck: PrecheckRunner;
  log: (msg: string) => void;
  reporter: EventReporter;
  findSessionByRef?: (ref: string) => string | undefined;
}): Plugin {
  const startSession = async (
    payload: TriggerEventPayload,
    task: string,
  ): Promise<void> => {
    const platformMeta = {
      type: payload.once ? SessionType.ScheduleOnce : SessionType.ScheduleCron,
      mode: SessionMode.Chat,
      scheduleId: payload.scheduleId,
    };
    const origin = payload.origin;
    if (origin?.mode === "continue") {
      const originSession = deps.findSessionByRef?.(origin.sessionRef);
      if (originSession) {
        await deps.driver.start({
          task: continuationPrompt(origin.name, task),
          mcpServers: payload.mcpServers,
          resumeSessionId: originSession,
          unattended: true,
        });
        return;
      }
      deps.log(
        `[trigger] ${payload.scheduleId}: the session that scheduled it is gone; running in a fresh session`,
      );
    }
    if (origin?.mode === "report") {
      await deps.driver.start({
        task,
        mcpServers: payload.mcpServers,
        platformMeta: {
          ...platformMeta,
          reportTo: origin.sessionRef,
          reportName: origin.name,
        },
        ...(payload.model ? { model: payload.model } : {}),
      });
      return;
    }
    if (!payload.once && (payload.sessionMode ?? "fresh") === "continuous") {
      const { scheduleId } = payload;
      const prior = deps.stateStore.getSessionForSchedule(scheduleId);
      const beforeSwitch = prior
        ? deps.stateStore.getModelBeforeSwitch(scheduleId)
        : undefined;
      const model =
        payload.model ??
        (beforeSwitch
          ? ((await deps.configuredModel()) ?? beforeSwitch)
          : undefined);
      const res = await deps.driver.start({
        task,
        mcpServers: payload.mcpServers,
        ...(prior ? { resumeSessionId: prior } : { platformMeta }),
        model,
      });
      if (!prior)
        deps.stateStore.setSessionForSchedule(scheduleId, res.sessionId);
      if (!payload.model) deps.stateStore.clearModelBeforeSwitch(scheduleId);
      else if (!beforeSwitch && res.openedOn)
        deps.stateStore.setModelBeforeSwitch(scheduleId, res.openedOn);
      return;
    }
    await deps.driver.start({
      task,
      mcpServers: payload.mcpServers,
      platformMeta,
      ...(payload.model ? { model: payload.model } : {}),
    });
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
        : await runOrRefuse(
            payload,
            withContext(payload.task, outcome.context),
          );
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

  const fire = async (
    payload: TriggerEventPayload,
    ctx: EventContext,
  ): Promise<void> => {
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
