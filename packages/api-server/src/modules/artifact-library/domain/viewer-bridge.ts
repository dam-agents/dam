import { ARTIFACT_PROMPT_MAX_LENGTH } from "api-server-api";
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
  | "not-agent-published"
  | "feature-off";

export type ViewerBridgeAccess =
  | { allowed: true; agentId: string }
  | { allowed: false; denial: ViewerBridgeDenial };

export const viewerPromptInputSchema = z.object({
  prompt: z.string().trim().min(1).max(ARTIFACT_PROMPT_MAX_LENGTH),
});

export type ViewerPromptResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        "invalid-request" | "not-allowed" | "agent-unreachable" | "spend-limit";
    };

/**
 * UNIT_BOUNDARY_DESCRIPTION: decides whether a viewer of a shared copy may
 * reach the artifact's Agent at all. Only a restricted, interactive HTML page
 * that an Agent published qualifies, and only while its owner keeps the
 * interactive-artifacts feature on. It is asked again on every call, so a
 * page the owner makes private or plain stops reaching the Agent at once.
 */
export function viewerBridgeAccess(
  row: {
    kind: string;
    interactive: boolean;
    visibility: string;
    agentId: string | null;
  },
  featureOn: boolean,
): ViewerBridgeAccess {
  if (row.kind !== "html") return { allowed: false, denial: "not-html" };
  if (!row.interactive) return { allowed: false, denial: "not-interactive" };
  if (row.visibility !== "restricted")
    return { allowed: false, denial: "not-restricted" };
  if (row.agentId === null)
    return { allowed: false, denial: "not-agent-published" };
  if (!featureOn) return { allowed: false, denial: "feature-off" };
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

export function viewerSessionKey(artifactId: string, viewerSub: string) {
  return `artifact:${artifactId}:${viewerSub}`;
}

export function viewerSessionTitle(viewer: string, title: string): string {
  const full = `${viewer} · ${title}`;
  return full.length <= SESSION_TITLE_MAX_LENGTH
    ? full
    : `${full.slice(0, SESSION_TITLE_MAX_LENGTH - 1)}…`;
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
