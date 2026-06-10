export type { TransportError, AuthRequiredError } from "../../shared/errors.js";

export interface ScheduleNotFoundError {
  kind: "schedule-not-found";
  id: string;
}

export interface InvalidInputError {
  kind: "invalid-input";
  message: string;
}
