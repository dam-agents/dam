export interface TransportError {
  kind: "transport";
  reason: string;
}

export interface AuthRequiredError {
  kind: "auth-required";
  reason: string;
}
