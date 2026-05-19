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
