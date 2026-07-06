import type { WakeFailureCause } from "../../agents/index.js";

/** End-user sentence for a wake failure, shared by the channel workers.
 *  The cause taxonomy is agents-domain; the tone and retry advice are a
 *  channel-presentation concern, so the copy lives here. Deliberately
 *  never interpolates raw controller messages — those can carry
 *  resource names and belong in logs. */
export function wakeFailureUserCopy(c: WakeFailureCause): string {
  switch (c.kind) {
    case "not-found":
      return "This agent no longer exists — it may have been deleted.";
    case "hibernated-not-scaled":
      return (
        "The agent couldn't be woken — the platform never started it. " +
        "Try again; if this keeps happening, contact an admin."
      );
    case "agent-pod-failed":
      switch (c.terminationReason) {
        case "ImagePullFailure":
        case "InvalidImageName":
          return (
            "This agent failed to start: its image can't be pulled " +
            "(check the image name and registry credential). " +
            "Check the agent's page or contact its owner."
          );
        case "OutOfMemory":
          return (
            "This agent failed to start: it ran out of memory. " +
            "Check the agent's page or contact its owner."
          );
        default:
          return (
            "This agent failed to start: it crashed while starting. " +
            "Check the agent's page or contact its owner."
          );
      }
    case "reconcile-error":
      return (
        "This agent failed to start: its configuration couldn't be " +
        "applied. Check the agent's page or contact its owner."
      );
    case "agent-pod-not-ready":
      return "The agent is still warming up — give it a minute and try again.";
    case "gateway-not-ready":
      return (
        "The agent is still warming up (its network gateway is starting) — " +
        "give it a minute and try again."
      );
    case "unknown":
      return "The agent didn't become ready in time — try again in a minute.";
  }
}
