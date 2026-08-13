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

export type AuthConfigProbeErrorCode =
  | "network"
  | "non-ok-status"
  | "malformed-response"
  | "missing-cli-client-id";

export interface AuthConfigProbeError {
  kind: "auth-config-probe";
  code: AuthConfigProbeErrorCode;
  message: string;
}

export type OidcDiscoveryErrorCode =
  | "network"
  | "non-ok-status"
  | "malformed-response"
  | "missing-device-endpoint";

export interface OidcDiscoveryError {
  kind: "oidc-discovery";
  code: OidcDiscoveryErrorCode;
  message: string;
}

export type DeviceFlowErrorCode =
  | "network"
  | "non-ok-status"
  | "malformed-response";

export interface DeviceFlowError {
  kind: "device-flow";
  code: DeviceFlowErrorCode;
  message: string;
}

export interface TokenTransportError {
  kind: "token-transport";
  reason: string;
}

export interface BrowserOpenError {
  kind: "browser-open";
  reason: string;
}

export interface RevokeError {
  kind: "revoke-failed";
  reason: string;
}

export interface NotLoggedInError {
  kind: "not-logged-in";
  host: string;
}

export interface SessionExpiredError {
  kind: "session-expired";
  host: string;
}

export interface RefreshFailedError {
  kind: "refresh-failed";
  host: string;
  reason: string;
}

export interface RefreshTransientError {
  kind: "refresh-transient";
  host: string;
  reason: string;
}

export type TokenProviderError =
  | NotLoggedInError
  | SessionExpiredError
  | RefreshFailedError
  | RefreshTransientError
  | AuthStoreReadError
  | AuthStoreWriteError
  | MalformedAuthStoreError;

export type AuthDomainError =
  | AuthStoreReadError
  | AuthStoreWriteError
  | MalformedAuthStoreError
  | AuthConfigProbeError
  | OidcDiscoveryError
  | DeviceFlowError
  | TokenTransportError
  | BrowserOpenError
  | NotLoggedInError
  | SessionExpiredError
  | RefreshFailedError
  | RefreshTransientError
  | RevokeError;
