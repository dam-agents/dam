import {
  serviceErrorDescription,
  type ErrorDescription,
} from "../../shared/trpc/print.js";
import { EXIT_INVALID_INPUT } from "../../shared/exit-codes.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";

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

export type ChannelError =
  | TransportError
  | AuthRequiredError
  | ChannelConflictError
  | ChannelPreconditionError
  | ChannelInvalidInputError;

export function describeChannelError(
  error: ChannelError,
  host: string,
): ErrorDescription {
  switch (error.kind) {
    case "channel-conflict":
      return {
        stderr:
          "error: this agent is already connected to that Slack channel\n",
        exitCode: EXIT_INVALID_INPUT,
      };
    case "channel-precondition":
    case "invalid-input":
      return {
        stderr: `error: ${error.message}\n`,
        exitCode: EXIT_INVALID_INPUT,
      };
    case "transport":
    case "auth-required":
      return serviceErrorDescription(error, host);
  }
}
