export type RequestBinding =
  | { kind: "artifact-session" }
  | { kind: "bound"; sessionId: string }
  | { kind: "pin"; sessionId: string };

export interface BindablePage {
  ownSession: boolean;
  sessionId: string | null;
}

// UNIT_BOUNDARY_DESCRIPTION: Where a page asks. A page bound to a conversation asks there for the rest of its life, and the platform MCP server is mounted per agent, so nothing on the create path knows which conversation the page was written in. The app does: it is signed in and it draws the page inside the chat, so it sends the open session with every ask. The first ask that carries one pins the page, and every ask after that uses the pinned one and ignores what it was offered — a page answered in one chat must never start driving another. Pinning is not limited to the page's very first ask, because a page can be asked from the Artifacts destination with no chat open, and settling that page as sessionless for life would make where it asks depend on where it happened to be opened first. An `own_session` page never binds and asks in its own Artifact Session, which is the only home that outlives the chat. So does a page nobody has yet asked from a chat, and so does every page published before this rule existed, whose `sessionId` is null.
export function resolveBinding(
  page: BindablePage,
  offered: string | null,
): RequestBinding {
  if (page.ownSession) return { kind: "artifact-session" };
  if (page.sessionId !== null)
    return { kind: "bound", sessionId: page.sessionId };
  if (offered !== null) return { kind: "pin", sessionId: offered };
  return { kind: "artifact-session" };
}
