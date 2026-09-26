import type {
  EventHandler,
  ExperimentExecuteEventPayload,
  Plugin,
  SatelliteOutcomeEventPayload,
} from "agent-runtime-api";
import { initializationEventPayload } from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";

import type { TriggerSessionDriver } from "../../acp/index.js";

type SessionStart = Parameters<TriggerSessionDriver["start"]>[0];

function sessionEventPlugin(
  name: string,
  toStart: (payload: unknown) => SessionStart,
): (deps: { driver: TriggerSessionDriver }) => Plugin {
  return (deps) => ({
    name,
    bindEvent(kind: string): EventHandler {
      if (kind !== name) {
        throw new Error(
          `plugin "${name}" does not handle event kind "${kind}"`,
        );
      }
      return async (payload) => {
        await deps.driver.start(toStart(payload));
      };
    },
  });
}

export const createInitializationPlugin = sessionEventPlugin(
  "initialization",
  (payload) => ({
    task: initializationEventPayload.parse(payload).task,
    platformMeta: {
      type: SessionType.Regular,
      mode: SessionMode.Chat,
      initialization: true,
    },
  }),
);

export const createExperimentExecutePlugin = sessionEventPlugin(
  "experiment-execute",
  (payload) => {
    const p = payload as ExperimentExecuteEventPayload;
    return {
      task: p.task,
      platformMeta: {
        type: SessionType.ExperimentExecute,
        mode: SessionMode.Chat,
        experimentId: p.experimentId,
      },
    };
  },
);

/**
 * UNIT_BOUNDARY_DESCRIPTION: Handles the satellite-outcome Event. A satellite
 * Job runs for as long as the machine needs, so it outlives the turn that
 * started it. When it ends, the api-server sends this Event carrying the same
 * text the wait tool would have returned, and this handler opens a Session and
 * prompts the harness with it. The Session is a regular chat one on purpose:
 * the turn belongs in the list where a user looks for what their agent did.
 */
export const createSatelliteOutcomePlugin = sessionEventPlugin(
  "satellite-outcome",
  (payload) => ({
    task: (payload as SatelliteOutcomeEventPayload).task,
    platformMeta: { type: SessionType.Regular, mode: SessionMode.Chat },
  }),
);
