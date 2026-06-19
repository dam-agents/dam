export type { TransportError, AuthRequiredError } from "../../shared/errors.js";

/** The Slack channel id is already bound to a different Agent (server CONFLICT). */
export interface ChannelConflictError {
  kind: "channel-conflict";
  message: string;
}

/** The operator hasn't enabled this provider on the host (server
 *  PRECONDITION_FAILED). Normally caught by the client-side `available`
 *  precheck; this is the defensive fallback when the mutation returns it. */
export interface ChannelPreconditionError {
  kind: "channel-precondition";
  message: string;
}
