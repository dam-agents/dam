import type { Sender } from "agent-runtime-api";
import type { AgentAccess } from "api-server-api";

export interface SenderNames {
  viewerSub: string | undefined;
  nameOf: (sender: Sender) => string;
  otherName: (sender: Sender | null | undefined) => string | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: how the chat and the session lists name a
 * person: "You" for the viewer, else the email recorded when they acted. A
 * Sender with no email signed in with an API key, which only the owner can
 * use, so an editor sees the owner's email there. `otherName` is null for the
 * viewer and for no one, which is where nothing is shown.
 */
export function senderNames(
  viewerSub: string | undefined,
  access: AgentAccess | undefined,
): SenderNames {
  const fallback =
    access?.role === "editor" ? (access.ownerEmail ?? undefined) : undefined;
  const nameOf = (sender: Sender): string => {
    if (sender.sub === viewerSub) return "You";
    return sender.email ?? fallback ?? "Someone else";
  };
  return {
    viewerSub,
    nameOf,
    otherName: (sender) =>
      sender === null || sender === undefined || sender.sub === viewerSub
        ? null
        : nameOf(sender),
  };
}
