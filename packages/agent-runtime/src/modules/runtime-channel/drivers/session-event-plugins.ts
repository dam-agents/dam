import type {
  EventHandler,
  Plugin,
  SatelliteOutcomeEventPayload,
} from "agent-runtime-api";
import {
  initializationEventPayload,
  subAgentOutcomeEventPayload,
} from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";

import type {
  SubAgentSessionStore,
  TriggerSessionDriver,
} from "../../acp/index.js";

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

/**
 * UNIT_BOUNDARY_DESCRIPTION: Handles the sub-agent-outcome Event: a sub-agent
 * this agent spawned through the spawn_subagent tool finished while nothing was
 * waiting on it. The Event carries what await_subagents would have returned, and
 * the turn continues the Session whose tool call spawned it, so the
 * result lands where it was asked for. A Session the store no longer knows
 * falls back to a new regular chat Session.
 */
export function createSubAgentOutcomePlugin(deps: {
  driver: TriggerSessionDriver;
  sessions: SubAgentSessionStore;
}): Plugin {
  return {
    name: "sub-agent-outcome",
    bindEvent(kind: string): EventHandler {
      if (kind !== "sub-agent-outcome") {
        throw new Error(
          `plugin "sub-agent-outcome" does not handle event kind "${kind}"`,
        );
      }
      return async (payload) => {
        const { task, ids } = subAgentOutcomeEventPayload.parse(payload);
        const resumeSessionId = deps.sessions.sessionOf(ids);
        await deps.driver.start(
          resumeSessionId
            ? { task, resumeSessionId }
            : {
                task,
                platformMeta: {
                  type: SessionType.Regular,
                  mode: SessionMode.Chat,
                },
              },
        );
      };
    },
  };
}
