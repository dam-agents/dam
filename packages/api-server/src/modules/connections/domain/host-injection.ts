/**
 * One credential-injection target on a single host. A connection
 * (k8s-connections-port) carries a list of these — authoritative for
 * Envoy filter-chain rendering AND the egress allowlist. See issue #219.
 */
export interface ConnectionHostInjection {
  host: string;
  /** Path-prefix scoping the egress rule. */
  pathPattern?: string;
  /** Default `Authorization`. */
  headerName?: string;
  /** Default `Bearer {value}`. */
  valueFormat?: string;
  /**
   * Token transform applied before `{value}` substitution.
   * `basic-x-access-token` → `base64("x-access-token:" + token)`, paired
   * with `valueFormat: "Basic {value}"` for `git clone` over HTTPS.
   */
  encoding?: "basic-x-access-token";
}

export const DEFAULT_INJECTION_HEADER = "Authorization";
export const DEFAULT_INJECTION_VALUE_FORMAT = "Bearer {value}";

export function injectionHeader(h: ConnectionHostInjection): string {
  return h.headerName ?? DEFAULT_INJECTION_HEADER;
}

export function injectionValueFormat(h: ConnectionHostInjection): string {
  return h.valueFormat ?? DEFAULT_INJECTION_VALUE_FORMAT;
}

/**
 * Apply the host's `encoding` to the raw access token. Pure; called from
 * both the connect path and the refresh-loop path.
 */
export function encodeAccessToken(
  rawToken: string,
  encoding: ConnectionHostInjection["encoding"],
): string {
  if (encoding === "basic-x-access-token") {
    return Buffer.from(`x-access-token:${rawToken}`, "utf8").toString("base64");
  }
  return rawToken;
}
