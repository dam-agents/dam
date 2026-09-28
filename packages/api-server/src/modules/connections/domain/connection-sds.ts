import type { Contribution } from "api-server-api";

export const CONNECTION_TOKEN_PLACEHOLDER = "dummy-placeholder";

export const UPSTREAM_CA_SECRET_FIELD = "upstream-ca.crt";

export function sdsFileKeyForHost(host: string): string {
  const slug = Buffer.from(host, "utf8").toString("base64url");
  return `host-${slug}.sds.yaml`;
}

function sdsFileKeyForInjection(c: {
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

function sdsYamlContent(inlineString: string): string {
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
    const encoded =
      c.encoding === "basic-x-access-token"
        ? Buffer.from(`x-access-token:${accessToken}`, "utf8").toString(
            "base64",
          )
        : accessToken;
    const inlineString = c.queryParamName
      ? accessToken
      : c.valueFormat.replaceAll("{value}", encoded);
    out[sdsFileKeyForInjection(c)] = sdsYamlContent(inlineString);
  }
  return out;
}

export function connectionSecretAnnotations(
  contributions: Contribution[],
): Record<string, string> {
  const injectionHosts = contributions
    .filter(
      (c): c is Extract<Contribution, { kind: "egress-inject" }> =>
        c.kind === "egress-inject",
    )
    .map((c) => ({
      host: c.host,
      ...(c.pathPattern ? { pathPattern: c.pathPattern } : {}),
      ...(c.pathRewrites ? { pathRewrites: c.pathRewrites } : {}),
      headerName: c.headerName,
      valueFormat: c.valueFormat,
      ...(c.encoding ? { encoding: c.encoding } : {}),
      ...(c.queryParamName ? { queryParamName: c.queryParamName } : {}),
      ...(c.http2 ? { http2: c.http2 } : {}),
      ...(c.port ? { port: c.port } : {}),
      ...(c.upgrades ? { upgrades: c.upgrades } : {}),
      ...(c.upstreamCa ? { caKey: UPSTREAM_CA_SECRET_FIELD } : {}),
      sdsKey: sdsFileKeyForInjection(c),
    }));

  const out: Record<string, string> = {};
  if (injectionHosts.length > 0) {
    out["agent-platform.ai/injection-hosts"] = JSON.stringify(injectionHosts);
  }
  return out;
}
