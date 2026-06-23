export type { TransportError, AuthRequiredError } from "../../shared/errors.js";

export interface NotFoundError {
  kind: "not-found";
  ref: string;
  via: "id" | "name";
}

export interface AmbiguousError {
  kind: "ambiguous";
  ref: string;
  matches: readonly { id: string; name: string }[];
}

/** Server rejected the input (TRPCError BAD_REQUEST) — carries the server's
 *  message so the command can surface it and exit `EXIT_INVALID_INPUT`. */
export interface InvalidInputError {
  kind: "invalid-input";
  message: string;
}
