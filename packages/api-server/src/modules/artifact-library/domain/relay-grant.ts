import { createHash } from "node:crypto";

import { SHARE_SESSION_TTL_MS } from "./share-session.js";

export const RELAY_TOKEN_TTL_MS = SHARE_SESSION_TTL_MS;

export interface RelayCaller {
  artifactId: string;
  version: number;
  viewerSub: string;
  shareSessionId: string;
}

export interface RelayGrant {
  artifactId: string;
  version: number;
  viewerSub: string;
  signIn: string;
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isRelayTokenShape(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}

function signInDigest(shareSessionId: string): string {
  return createHash("sha256").update(shareSessionId).digest("base64url");
}

export function relayGrantFor(caller: RelayCaller): RelayGrant {
  return {
    artifactId: caller.artifactId,
    version: caller.version,
    viewerSub: caller.viewerSub,
    signIn: signInDigest(caller.shareSessionId),
  };
}

export function relayGrantCovers(
  grant: RelayGrant,
  caller: RelayCaller,
): boolean {
  return (
    grant.artifactId === caller.artifactId &&
    grant.version === caller.version &&
    grant.viewerSub === caller.viewerSub &&
    grant.signIn === signInDigest(caller.shareSessionId)
  );
}
