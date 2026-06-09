export type { TransportError, AuthRequiredError } from "../../shared/errors.js";

/** Wake-path verb couldn't make the agent reachable (error state / wake
 *  timeout). The CLI sent an agentId and the server still failed. → exit 7. */
export interface AgentNotReachableError {
  kind: "agent-not-reachable";
  reason: string;
}

/** `catalog` on a private/non-GitHub source with no --agent: the server can't
 *  scan it without a pod. → exit 2 with a "pass --agent" hint. */
export interface PrivateSourceNeedsAgentError {
  kind: "private-source-needs-agent";
}

/** The scan reached the pod but GitHub refused: the source's app isn't
 *  connected or access is restricted. The server encodes a fix-it URL as a
 *  `platform-cta:` marker. Distinct from an unreachable pod. → exit 2. */
export interface SourceNeedsConnectionError {
  kind: "source-needs-connection";
  message: string;
  cta?: string;
}

/** `add` of a gitUrl already registered as one of your User sources (the
 *  server returns CONFLICT). → exit 2. */
export interface SourceAlreadyExistsError {
  kind: "source-exists";
}

/** `refresh` race: the source resolved client-side but the server NOT_FOUND'd
 *  it (deleted between list and refresh). → exit 2. */
export interface SourceNotFoundError {
  kind: "source-not-found";
}

/** publish reached the pod but GitHub refused — app not connected, agent not
 *  granted, or repo not in the allowlist. The server encodes a fix-it URL as a
 *  `platform-cta:` marker. The CLI strips it and prints `Fix: <url>`. → exit 2. */
export interface PublishNeedsConnectionError {
  kind: "publish-needs-connection";
  message: string;
  cta?: string;
}

/** publish hit a server-side application error from a reachable agent — the
 *  named skill doesn't exist, or GitHub rejected the request (403/404/5xx).
 *  Carries the server message, printed verbatim. → exit 1. */
export interface PublishFailedError {
  kind: "publish-failed";
  message: string;
}
