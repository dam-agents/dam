import type {
  DriverBinding,
  EventContext,
  EventHandler,
  EventOutcome,
  Plugin,
  ScheduleResetEventPayload,
  TriggerEventPayload,
} from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";
import type { TriggerSessionDriver } from "../../acp/index.js";
import type { PrecheckOutcome } from "../domain/precheck.js";
import type { PrecheckRunner } from "../infrastructure/precheck-runner.js";
import type { TriggerStateStore } from "../infrastructure/trigger-state-store.js";

const IMPL_NAME = "trigger";

export interface EventReporter {
  report(input: {
    eventId: string;
    outcome: EventOutcome;
    detail?: string;
  }): Promise<void>;
}

const WIRE_OUTCOME: Record<PrecheckOutcome["verdict"], EventOutcome> = {
  allowed: "ok",
  declined: "declined",
  "precheck-failed": "failed",
};

function withContext(task: string, context: string | undefined): string {
  return context ? `${task}\n\n---\nPrecheck output:\n${context}` : task;
}

export function createTriggerPlugin(deps: {
  driver: TriggerSessionDriver;
  stateStore: TriggerStateStore;
  runPrecheck: PrecheckRunner;
  log: (msg: string) => void;
  reporter: EventReporter;
}): Plugin {
  const startSession = async (
    payload: TriggerEventPayload,
    task: string,
  ): Promise<void> => {
    const platformMeta = {
      type: SessionType.ScheduleCron,
      mode: SessionMode.Chat,
      scheduleId: payload.scheduleId,
    };
    if ((payload.sessionMode ?? "fresh") === "continuous") {
      const prior = deps.stateStore.getSessionForSchedule(payload.scheduleId);
      if (prior) {
        await deps.driver.start({
          task,
          mcpServers: payload.mcpServers,
          resumeSessionId: prior,
        });
        return;
      }
      const res = await deps.driver.start({
        task,
        mcpServers: payload.mcpServers,
        platformMeta,
      });
      deps.stateStore.setSessionForSchedule(payload.scheduleId, res.sessionId);
      return;
    }
    await deps.driver.start({
      task,
      mcpServers: payload.mcpServers,
      platformMeta,
    });
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
    try {
      await deps.reporter.report({
        eventId,
        outcome: WIRE_OUTCOME[outcome.verdict],
        ...(outcome.detail ? { detail: outcome.detail } : {}),
      });
    } catch (err) {
      deps.log(`[trigger] event report failed: ${(err as Error).message}`);
    }
    if (outcome.verdict === "declined") return;
    await startSession(payload, withContext(payload.task, outcome.context));
  };

  const fire = async (
    payload: TriggerEventPayload,
    ctx: EventContext,
  ): Promise<void> => {
    if (!payload.precheck) return startSession(payload, payload.task);
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
