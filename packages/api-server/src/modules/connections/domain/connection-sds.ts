import { createHash } from "node:crypto";
import type { Contribution } from "api-server-api";
import {
  DEFAULT_INJECTION_VALUE_FORMAT,
  encodeAccessToken,
} from "./host-injection.js";

const PLACEHOLDER_TOKEN = "dummy-placeholder";

/**
 * Per-host SDS file key inside a connection Secret. MUST stay byte-identical
 * with the controller's `sdsFileKeyForHost` (envoy.go) — the two halves
 * agree on the file name or Envoy fails to boot. SHA-1 is non-cryptographic
 * use; it just shortens the host string into a K8s-safe key.
 */
export function sdsFileKeyForHost(host: string): string {
  const hash = createHash("sha1").update(host).digest("hex").slice(0, 8);
  return `host-${hash}.sds.yaml`;
}

/**
 * Envoy SDS DiscoveryResponse wrapping a `generic_secret` inline string.
 * The gateway pod's Envoy bootstrap references this file via
 * `path_config_source` and reads the inline value verbatim as the header
 * value the credential_injector splices onto outbound requests.
 */
export function sdsYamlContent(inlineString: string): string {
  return [
    "resources:",
    '- "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret',
    "  name: credential",
    "  generic_secret:",
    "    secret:",
    `      inline_string: ${JSON.stringify(inlineString)}`,
    "",
  ].join("\n");
}

/**
 * Build one SDS YAML file per `egress-host` contribution that carries an
 * `injection` config — these are the hosts the controller renders an L7
 * credential-injector chain for. Hosts without `injection` are routing-only
 * (egress allowlist) and contribute no SDS file.
 *
 * `accessToken` is the raw token from the OAuth exchange / refresh. Pass
 * the placeholder constant at create-time so the Secret has the right keys
 * before OAuth completes — the gateway pod's Envoy then boots cleanly and
 * traffic just gets a placeholder header until tokens land.
 */
export function buildConnectionSdsFields(
  contributions: Contribution[],
  accessToken: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of contributions) {
    if (c.kind !== "egress-host" || !c.injection) continue;
    const headerValue = (
      c.injection.valueFormat ?? DEFAULT_INJECTION_VALUE_FORMAT
    ).replaceAll(
      "{value}",
      encodeAccessToken(accessToken, c.injection.encoding),
    );
    out[sdsFileKeyForHost(c.host)] = sdsYamlContent(headerValue);
  }
  return out;
}

/** Placeholder used at create-time when no real access token exists yet. */
export const CONNECTION_TOKEN_PLACEHOLDER = PLACEHOLDER_TOKEN;
