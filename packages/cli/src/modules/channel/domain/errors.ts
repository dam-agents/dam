export type { TransportError, AuthRequiredError } from "../../shared/errors.js";

export interface ChannelConflictError {
  kind: "channel-conflict";
  message: string;
}

export interface ChannelPreconditionError {
  kind: "channel-precondition";
  message: string;
}

export interface ChannelInvalidInputError {
  kind: "invalid-input";
  message: string;
}
