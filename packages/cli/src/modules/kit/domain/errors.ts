export type { TransportError, AuthRequiredError } from "../../shared/errors.js";

export interface KitRefusedError {
  kind: "kit-refused";
  code: string;
  reason: string;
}

export interface KitNotFoundError {
  kind: "kit-not-found";
  ref: string;
}

export interface KitAmbiguousError {
  kind: "kit-ambiguous";
  ref: string;
  matches: readonly string[];
}
