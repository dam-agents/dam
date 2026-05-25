export type { TransportError, AuthRequiredError } from "../../shared/errors.js";

export interface RuleNotFoundError {
  kind: "rule-not-found";
  id: string;
}
