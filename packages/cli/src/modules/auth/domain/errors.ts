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

/**
 * `GET <server>/api/auth/config` failures.
 *
 * `missing-cli-client-id` is distinct from `malformed-response` because it
 * is the "server too old" signal — issue 1 of the cli-auth rollout adds the
 * `cliClientId` field, and a deployment without that field cannot host the
 * device flow. Issue 6's command layer turns it into "your platform server
 * needs to be upgraded to v0.X.Y+".
 */
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

/**
 * `GET <issuer>/.well-known/openid-configuration` failures.
 *
 * `missing-device-endpoint` is distinct from `malformed-response` because
 * it is the "realm not configured for device flow" signal — typically a
 * mis-rendered or hand-edited Keycloak realm. Issue 6's command layer
 * turns it into a Keycloak-config-pointing message.
 */
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

/**
 * `POST <device_authorization_endpoint>` failures. The device-authorization
 * request happens once, before polling begins; its failures are simple
 * transport conditions plus malformed-response.
 */
export type DeviceFlowErrorCode =
  | "network"
  | "non-ok-status"
  | "malformed-response";

export interface DeviceFlowError {
  kind: "device-flow";
  code: DeviceFlowErrorCode;
  message: string;
}

/**
 * `POST <token_endpoint>` HTTP-transport failures. OAuth-level errors
 * (the response body's `error` / `error_description` fields) do NOT come
 * through here — those parse as a valid TokenEndpointResponse and feed
 * the state machine, which decides what is terminal. This variant is
 * only for the cases where the call did not produce a parseable OAuth
 * response at all: connection refused, malformed JSON, non-2xx without
 * an OAuth error body, etc.
 */
export interface TokenTransportError {
  kind: "token-transport";
  reason: string;
}

/** The `open` package rejected — typically no GUI available (SSH / CI). */
export interface BrowserOpenError {
  kind: "browser-open";
  reason: string;
}

export type AuthDomainError =
  | AuthStoreReadError
  | AuthStoreWriteError
  | MalformedAuthStoreError
  | AuthConfigProbeError
  | OidcDiscoveryError
  | DeviceFlowError
  | TokenTransportError
  | BrowserOpenError;
