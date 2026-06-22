export interface TransportError {
  kind: "transport";
  reason: string;
  serverCode?: string;
}

export interface AuthRequiredError {
  kind: "auth-required";
  reason: string;
}
