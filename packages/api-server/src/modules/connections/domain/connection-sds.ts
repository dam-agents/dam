import type { Contribution } from "api-server-api";
import { encodeAccessToken } from "./host-injection.js";

const PLACEHOLDER_TOKEN = "dummy-placeholder";

export function sdsFileKeyForHost(host: string): string {
  const slug = Buffer.from(host, "utf8").toString("base64url");
  return `host-${slug}.sds.yaml`;
}

// One SDS file per injection. Header injections keep the per-host key; query-param injections key off host+header so they don't collide with the header injection on the same host.
export function sdsFileKeyForInjection(c: {
  host: string;
  headerName: string;
  queryParamName?: string;
}): string {
  if (!c.queryParamName) return sdsFileKeyForHost(c.host);
  const slug = Buffer.from(`${c.host}\n${c.headerName}`, "utf8").toString(
    "base64url",
  );
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
    // Query-param injections store the bare value; the Lua url-encodes it, so a baked `Bearer `/`Apikey ` prefix would corrupt the URL.
    const inlineString = c.queryParamName
      ? accessToken
      : c.valueFormat.replaceAll(
          "{value}",
          encodeAccessToken(accessToken, c.encoding),
        );
    out[sdsFileKeyForInjection(c)] = sdsYamlContent(inlineString);
  }
  return out;
}

export const CONNECTION_TOKEN_PLACEHOLDER = PLACEHOLDER_TOKEN;
