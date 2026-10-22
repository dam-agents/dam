import {
  startupItemsEventPayload,
  type DriverBinding,
  type EventHandler,
  type Plugin,
  type StartupItemsEventPayload,
} from "agent-runtime-api";

const IMPL_NAME = "startup-items";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Handles the startup-items Event, which carries
 * the Startup Items a starter kit declared, sent once when the agent is
 * created. It hands them to the processes module, which writes them as the
 * agent's openrc services.
 */
export function createStartupItemsPlugin(deps: {
  onStartupItems: (payload: StartupItemsEventPayload) => Promise<void>;
}): Plugin {
  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind !== "startup-items") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
        );
      }
      return (payload) =>
        deps.onStartupItems(startupItemsEventPayload.parse(payload));
    },
  };
}
