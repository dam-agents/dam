import { createHash } from "node:crypto";
import type { Contribution } from "api-server-api";
import {
  DEFAULT_INJECTION_VALUE_FORMAT,
  encodeAccessToken,
} from "./host-injection.js";

const PLACEHOLDER_TOKEN = "dummy-placeholder";

export function sdsFileKeyForHost(host: string): string {
  const hash = createHash("sha1").update(host).digest("hex").slice(0, 8);
  return `host-${hash}.sds.yaml`;
}

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

export const CONNECTION_TOKEN_PLACEHOLDER = PLACEHOLDER_TOKEN;
