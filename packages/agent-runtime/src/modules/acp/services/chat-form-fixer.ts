import type { TriggerSessionDriver } from "./trigger-session-driver.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: delivers the prompt that sends a broken chat form
 * back to the agent into the Session whose reply held it, as a new turn of
 * that Session, the way a one-time task's result reaches the Session that
 * scheduled it. Nobody waits on the delivery, so a failure is only logged.
 */
export function createChatFormFixer(deps: {
  driver: TriggerSessionDriver;
  log: (msg: string) => void;
}): (sessionId: string, prompt: string) => void {
  return (sessionId, prompt) => {
    void deps.driver
      .start({ task: prompt, resumeSessionId: sessionId })
      .catch((err: Error) =>
        deps.log(
          `the broken chat form in ${sessionId} was not sent back: ${err.message}`,
        ),
      );
  };
}
