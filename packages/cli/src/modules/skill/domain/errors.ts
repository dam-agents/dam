export type { TransportError, AuthRequiredError } from "../../shared/errors.js";

export interface AgentNotReachableError {
  kind: "agent-not-reachable";
  reason: string;
}

export interface PrivateSourceNeedsAgentError {
  kind: "private-source-needs-agent";
}

export interface SourceNeedsConnectionError {
  kind: "source-needs-connection";
  message: string;
  cta?: string;
}

export interface SourceAlreadyExistsError {
  kind: "source-exists";
}

export interface SourceNotFoundError {
  kind: "source-not-found";
}

export interface PublishNeedsConnectionError {
  kind: "publish-needs-connection";
  message: string;
  cta?: string;
}

export interface PublishFailedError {
  kind: "publish-failed";
  message: string;
}
