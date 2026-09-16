import type {
  DriverBinding,
  EventHandler,
  OnboardingEventPayload,
  Plugin,
} from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";
import type { TriggerSessionDriver } from "../../acp/index.js";

const IMPL_NAME = "onboarding";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The handler for the `onboarding` event — a new
 * agent's opening turn, composed by the platform at create. It opens a regular
 * chat session, not a schedule-typed one, because the user has to be able to
 * find it and answer the questions it asks. The event loop's per-key ledger is
 * what makes the turn happen once; this handler only starts the session.
 */
export function createOnboardingPlugin(deps: {
  driver: TriggerSessionDriver;
}): Plugin {
  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind !== "onboarding") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
        );
      }
      return async (payload) => {
        const p = payload as OnboardingEventPayload;
        await deps.driver.start({
          task: p.task,
          platformMeta: {
            type: SessionType.Regular,
            mode: SessionMode.Chat,
            onboarding: true,
          },
        });
      };
    },
  };
}
