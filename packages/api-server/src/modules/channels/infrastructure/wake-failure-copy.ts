import type { WakeFailureCause } from "../../agents/index.js";

export function wakeFailureUserCopy(c: WakeFailureCause): string {
  switch (c.kind) {
    case "not-found":
      return "This agent no longer exists — it may have been deleted.";
    case "hibernated-not-started":
      return (
        "The agent couldn't be woken — the platform never started it. " +
        "Try again; if this keeps happening, contact an admin."
      );
    case "over-budget":
      return (
        "This agent can't start right now: its owner is at their compute " +
        "budget. Ask the owner to free room and start it again."
      );
    case "no-capacity":
      return (
        "This agent can't start right now: no node has room for it. " +
        "It starts as soon as room frees up."
      );
    case "sandbox-failed":
      return c.terminationReason === "ImagePullFailure"
        ? "This agent failed to start: its image can't be pulled " +
            "(check the image name and registry credential). " +
            "Check the agent's page or contact its owner."
        : "This agent failed to start: it crashed while starting. " +
            "Check the agent's page or contact its owner.";
    case "reconcile-error":
      return (
        "This agent failed to start: its configuration couldn't be " +
        "applied. Check the agent's page or contact its owner."
      );
    case "sandbox-not-ready":
      return "The agent is still warming up — give it a minute and try again.";
    case "gateway-not-ready":
      return (
        "The agent is still warming up (its network gateway is starting) — " +
        "give it a minute and try again."
      );
    case "node-unreachable":
      return (
        "The node this agent lives on isn't answering — give it a few " +
        "minutes and try again."
      );
    case "unknown":
      return "The agent didn't become ready in time — try again in a minute.";
  }
}
