import {
  ARTIFACT_PROMPT_MAX_LENGTH,
  artifactPromptConversationSchema,
} from "api-server-api";
import {
  artifactApiCallerEmail,
  SESSION_TITLE_MAX_LENGTH,
  type ArtifactApiCaller,
} from "agent-runtime-api";
import { z } from "zod";

import type { ShareSession } from "./share-session.js";

export type ViewerBridgeDenial =
  | "not-a-viewer"
  | "no-relay-token"
  | "not-html"
  | "not-interactive"
  | "not-restricted"
  | "not-agent-published";

export type ViewerBridgeAccess =
  | { allowed: true; agentId: string }
  | { allowed: false; denial: ViewerBridgeDenial };

export const viewerPromptInputSchema = z.object({
  prompt: z.string().trim().min(1).max(ARTIFACT_PROMPT_MAX_LENGTH),
  conversation: artifactPromptConversationSchema.optional(),
});

export type ViewerPromptResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invalid-request"
        | "not-allowed"
        | "agent-unreachable"
        | "spend-limit"
        | "profile-unavailable";
    };

/**
 * UNIT_BOUNDARY_DESCRIPTION: decides whether a viewer of a shared copy may
 * reach the artifact's Agent at all. Only a restricted, interactive HTML page
 * that an Agent published qualifies. It is asked again on every call, so a
 * page the owner makes private or plain stops reaching the Agent at once.
 */
export function viewerBridgeAccess(row: {
  kind: string;
  interactive: boolean;
  visibility: string;
  agentId: string | null;
}): ViewerBridgeAccess {
  if (row.kind !== "html") return { allowed: false, denial: "not-html" };
  if (!row.interactive) return { allowed: false, denial: "not-interactive" };
  if (row.visibility !== "restricted")
    return { allowed: false, denial: "not-restricted" };
  if (row.agentId === null)
    return { allowed: false, denial: "not-agent-published" };
  return { allowed: true, agentId: row.agentId };
}

export function shareCaller(
  artifact: { owner: string },
  session: ShareSession,
): ArtifactApiCaller {
  return {
    role: session.sub === artifact.owner ? "owner" : "viewer",
    email: artifactApiCallerEmail(
      session.emailVerified && session.email !== null
        ? session.email.trim().toLowerCase()
        : null,
    ),
    sub: session.sub,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a caller's Sessions for one page are keyed by
 * the page and the caller, so artifact code never picks a Session outside
 * them. A page's conversation only splits that caller's own Sessions: its key
 * has its own prefix and holds no colon, and the sub comes last, so no key
 * a page chooses can spell another caller's Session (a sub may hold colons).
 */
export function viewerSessionKey(
  artifactId: string,
  viewerSub: string,
  conversation?: string,
) {
  return conversation === undefined
    ? `artifact:${artifactId}:${viewerSub}`
    : `artifact-conversation:${artifactId}:${conversation}:${viewerSub}`;
}

function sessionTitle(full: string): string {
  return full.length <= SESSION_TITLE_MAX_LENGTH
    ? full
    : `${full.slice(0, SESSION_TITLE_MAX_LENGTH - 1)}…`;
}

function withConversation(full: string, conversation?: string): string {
  return conversation === undefined ? full : `${full} · ${conversation}`;
}

export function viewerSessionTitle(
  viewer: string,
  title: string,
  conversation?: string,
): string {
  return sessionTitle(withConversation(`${viewer} · ${title}`, conversation));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the owner's Session for a page is theirs alone,
 * so the page's title names it; a viewer's also names the viewer.
 */
export function ownerSessionTitle(
  title: string,
  conversation?: string,
): string {
  return sessionTitle(withConversation(title, conversation));
}

export function viewerPromptText(input: {
  viewer: string;
  artifactId: string;
  artifactTitle: string;
  prompt: string;
}): string {
  return [
    `${input.viewer} sent this from a button on the interactive artifact "${input.artifactTitle}" (id ${input.artifactId}).`,
    "Your owner shared that page with them, so they act under your owner's authority, as a person in a shared channel does.",
    "They see only the page: your reply text never reaches them. To show them a result, change the data the page reads from you, or publish a new version of the artifact.",
    "Nobody answers permission prompts on this turn: a tool call that asks is refused.",
    "",
    `Message: ${input.prompt}`,
  ].join("\n");
}

export function ownerPromptText(input: {
  artifactId: string;
  artifactTitle: string;
  prompt: string;
}): string {
  return [
    `Your owner sent this from a button on the interactive artifact "${input.artifactTitle}" (id ${input.artifactId}), opened outside a chat with you, so it starts or continues a Session of its own.`,
    "They see the page, and this Session only when they open it. To show them a result, change the data the page reads from you, or publish a new version of the artifact.",
    "Nobody answers permission prompts on this turn: a tool call that asks is refused.",
    "",
    `Message: ${input.prompt}`,
  ].join("\n");
}
