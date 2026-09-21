import type {
  DriverBinding,
  EventHandler,
  Plugin,
  SatelliteOutcomeEventPayload,
} from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";
import type { TriggerSessionDriver } from "../../acp/index.js";

const IMPL_NAME = "satellite-outcome";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Handles the satellite-outcome Event. A satellite
 * Job runs for as long as the machine needs, so it outlives the turn that
 * started it. When it ends, the api-server sends this Event carrying the same
 * text the wait tool would have returned, and this handler opens a Session and
 * prompts the harness with it. The Session is a regular chat one on purpose:
 * the turn belongs in the list where a user looks for what their agent did.
 */

export function createSatelliteOutcomePlugin(deps: {
  driver: TriggerSessionDriver;
}): Plugin {
  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind !== IMPL_NAME) {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
        );
      }
      return async (payload) => {
        const p = payload as SatelliteOutcomeEventPayload;
        await deps.driver.start({
          task: p.task,
          platformMeta: { type: SessionType.Regular, mode: SessionMode.Chat },
        });
      };
    },
  };
}
