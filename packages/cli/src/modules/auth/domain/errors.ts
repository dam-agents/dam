/**
 * Initial discriminated-error seed for the auth module's storage layer.
 * Extended by later issues (IdP discovery, device flow, token provider,
 * commands) as new failure paths land.
 */

export interface AuthStoreReadError {
  kind: "auth-store-read";
  reason: string;
}

export interface AuthStoreWriteError {
  kind: "auth-store-write";
  path: string;
  reason: string;
}

export interface MalformedAuthStoreError {
  kind: "malformed-auth-store";
  reason: string;
}

export type AuthDomainError =
  | AuthStoreReadError
  | AuthStoreWriteError
  | MalformedAuthStoreError;
