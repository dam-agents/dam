import type {
  DriverBinding,
  EventHandler,
  Plugin,
  ScheduleResetEventPayload,
  TriggerEventPayload,
} from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";
import type { TriggerSessionDriver } from "../../acp/index.js";
import { runPrecheck } from "../domain/precheck.js";
import type { TriggerStateStore } from "../infrastructure/trigger-state-store.js";

const IMPL_NAME = "trigger";

export interface FireReporter {
  report(input: {
    scheduleId: string;
    fireAt: string;
    verdict: "allowed" | "declined" | "precheck-failed";
    detail?: string;
  }): Promise<void>;
}

function withContext(task: string, context: string | undefined): string {
  return context ? `${task}\n\n---\nPrecheck output:\n${context}` : task;
}

export function createTriggerPlugin(deps: {
  driver: TriggerSessionDriver;
  stateStore: TriggerStateStore;
  workDir: string;
  log: (msg: string) => void;
  reporter?: FireReporter;
}): Plugin {
  const report = async (
    payload: TriggerEventPayload,
    verdict: "allowed" | "declined" | "precheck-failed",
    detail?: string,
  ): Promise<void> => {
    if (!deps.reporter || !payload.fireAt) return;
    try {
      await deps.reporter.report({
        scheduleId: payload.scheduleId,
        fireAt: payload.fireAt,
        verdict,
        ...(detail ? { detail } : {}),
      });
    } catch (err) {
      deps.log(`[trigger] fire report failed: ${(err as Error).message}`);
    }
  };

  const fire = async (payload: TriggerEventPayload): Promise<void> => {
    let task = payload.task;

    if (payload.precheck) {
      const outcome = await runPrecheck(
        {
          command: payload.precheck,
          workDir: deps.workDir,
          scheduleId: payload.scheduleId,
          ...(payload.fireAt ? { fireAt: payload.fireAt } : {}),
          ...(payload.lastRunAt ? { lastRunAt: payload.lastRunAt } : {}),
        },
        deps.log,
      );
      await report(payload, outcome.verdict, outcome.detail);
      if (outcome.verdict === "declined") return;
      task = withContext(task, outcome.context);
    }

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

  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind === "trigger") {
        return async (payload) => fire(payload as TriggerEventPayload);
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
