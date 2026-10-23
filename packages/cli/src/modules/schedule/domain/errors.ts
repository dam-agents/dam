import {
  serviceErrorDescription,
  type ErrorDescription,
} from "../../shared/trpc/print.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_SCHEDULE_NOT_FOUND,
} from "../../shared/exit-codes.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";

export type { TransportError, AuthRequiredError } from "../../shared/errors.js";

export interface ScheduleNotFoundError {
  kind: "schedule-not-found";
  id: string;
}

export interface InvalidInputError {
  kind: "invalid-input";
  message: string;
}

export type ScheduleError =
  | TransportError
  | AuthRequiredError
  | ScheduleNotFoundError
  | InvalidInputError;

export function describeScheduleError(
  error: ScheduleError,
  host: string,
): ErrorDescription {
  switch (error.kind) {
    case "schedule-not-found":
      return {
        stderr: `error: schedule not found: ${error.id}\n`,
        exitCode: EXIT_SCHEDULE_NOT_FOUND,
      };
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
