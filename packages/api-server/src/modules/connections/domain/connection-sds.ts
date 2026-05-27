import type { Contribution } from "api-server-api";
import { encodeAccessToken } from "./host-injection.js";

const PLACEHOLDER_TOKEN = "dummy-placeholder";

export function sdsFileKeyForHost(host: string): string {
  const slug = Buffer.from(host, "utf8").toString("base64url");
  return `host-${slug}.sds.yaml`;
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
    if (c.kind !== "egress-inject") continue;
    const headerValue = c.valueFormat.replaceAll(
      "{value}",
      encodeAccessToken(accessToken, c.encoding),
    );
    out[sdsFileKeyForHost(c.host)] = sdsYamlContent(headerValue);
  }
  return out;
}

export const CONNECTION_TOKEN_PLACEHOLDER = PLACEHOLDER_TOKEN;
