export interface TransportError {
  kind: "transport";
  reason: string;
}

export interface AuthRequiredError {
  kind: "auth-required";
  reason: string;
}

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

export type InstanceDomainError =
  | TransportError
  | AuthRequiredError
  | NotFoundError
  | AmbiguousError;
