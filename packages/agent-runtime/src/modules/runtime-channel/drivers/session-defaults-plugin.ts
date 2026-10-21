import {
  sessionDefaultsEventPayload,
  type DriverBinding,
  type EventHandler,
  type Plugin,
  type SessionDefaultsEventPayload,
} from "agent-runtime-api";

const IMPL_NAME = "session-defaults";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Handles the session-defaults Event, which
 * carries the agent's chat, channel and scheduled defaults whenever one
 * changes and after every hello. It hands them to the session router, which
 * applies them to the sessions that follow a default.
 */
export function createSessionDefaultsPlugin(deps: {
  onDefaults: (defaults: SessionDefaultsEventPayload) => void;
}): Plugin {
  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind !== "session-defaults") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
        );
      }
      return (payload) => {
        deps.onDefaults(sessionDefaultsEventPayload.parse(payload));
        return Promise.resolve();
      };
    },
  };
}
