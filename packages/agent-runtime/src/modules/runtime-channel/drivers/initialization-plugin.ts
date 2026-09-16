import type {
  DriverBinding,
  EventHandler,
  InitializationEventPayload,
  Plugin,
} from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";

import type { TriggerSessionDriver } from "../../acp/index.js";

const IMPL_NAME = "initialization";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The handler for the `initialization` event — the
 * first chat session the platform opens for a new agent, carrying the turn it
 * composed at create: a kit's briefing, a knowledge base's or an experiment's
 * onboarding command. It opens a regular chat session, not a schedule-typed
 * one, because the user has to be able to find it and answer it. The event
 * loop's per-key ledger is what makes the turn happen once; this handler only
 * starts the session.
 */
export function createInitializationPlugin(deps: {
  driver: TriggerSessionDriver;
}): Plugin {
  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind !== "initialization") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
        );
      }
      return async (payload) => {
        const p = payload as InitializationEventPayload;
        await deps.driver.start({
          task: p.task,
          platformMeta: {
            type: SessionType.Regular,
            mode: SessionMode.Chat,
            initialization: true,
          },
        });
      };
    },
  };
}
