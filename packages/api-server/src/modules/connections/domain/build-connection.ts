import type {
  ConnectionAuthConfig,
  ConnectionCreateInput,
  Contribution,
  SecretRef,
} from "api-server-api";
import type { ConnectionTemplate } from "./connection-template.js";
import {
  discoverMcpAuth,
  registerOAuthClient,
} from "../infrastructure/mcp-discovery.js";

/**
 * Project user input (auth-kind discriminated) + a Connection Template
 * (declarative data) into the Connection record's `auth` + `contributions`
 * + backing secret payload (ADR-051).
 *
 * Layering for OAuth templates:
 *   * Operator-supplied template defaults — `template.clientId` /
 *     `template.clientSecret` / endpoints / scopes.
 *   * User-supplied at create time — `input.clientId` etc.
 *   * User wins (override or fill-in); we throw if any field is still
 *     blank after the merge.
 *   * `template.dynamicRegistration` runs RFC 8414 / 9728 discovery +
 *     RFC 7591 DCR against `input.url` and synthesizes everything at
 *     create time; per-Connection `client_secret` lands in SecretStore
 *     via `clientSecretRef`.
 *
 * Header templates accept an optional `mcpConfig` — when set, the
 * Connection emits an mcp-entry Contribution carrying the user-pasted
 * JSON alongside the header auth + egress-host. Used by the "Custom
 * MCP server (custom)" flow.
 */
export interface BuildResult {
  auth: ConnectionAuthConfig;
  contributions: Contribution[];
  /**
   * Secret bytes to write into the SecretStore at create time. Map of
   * path → field → value. The Connections service writes these via
   * SecretStore.put before persisting the Connection row.
   */
  secrets: Map<string, Record<string, string>>;
  defaultName: string;
}

export async function buildConnection(
  template: ConnectionTemplate,
  input: ConnectionCreateInput,
  mintSecretRef: (purpose: string) => SecretRef,
  /** Public OAuth callback URL — needed for DCR's `redirect_uris`. */
  oauthCallbackUrl: string,
  /** Display name surfaced as `client_name` during DCR. */
  brandName: string,
): Promise<BuildResult> {
  if (input.authKind !== template.authKind) {
    throw new Error(
      `template ${template.id} expects authKind=${template.authKind}, got ${input.authKind}`,
    );
  }

  switch (input.authKind) {
    case "oauth":
      return buildOAuth(
        template as Extract<ConnectionTemplate, { authKind: "oauth" }>,
        input,
        mintSecretRef,
        oauthCallbackUrl,
        brandName,
      );
    case "header":
      return buildHeader(
        template as Extract<ConnectionTemplate, { authKind: "header" }>,
        input,
        mintSecretRef,
      );
    case "none":
      return buildNone(
        template as Extract<ConnectionTemplate, { authKind: "none" }>,
        input,
      );
  }
}

async function buildOAuth(
  template: Extract<ConnectionTemplate, { authKind: "oauth" }>,
  input: Extract<ConnectionCreateInput, { authKind: "oauth" }>,
  mintSecretRef: (purpose: string) => SecretRef,
  oauthCallbackUrl: string,
  brandName: string,
): Promise<BuildResult> {
  // Token-storage path. One Secret per Connection, three fields:
  // access_token, refresh_token, and (DCR-only) client_secret.
  const secretPath = mintSecretRef(`connection:${template.id}`);

  if (template.dynamicRegistration) {
    return buildOAuthDcr(
      template,
      input,
      secretPath,
      oauthCallbackUrl,
      brandName,
    );
  }
  return buildOAuthStatic(template, input, secretPath);
}

async function buildOAuthStatic(
  template: Extract<ConnectionTemplate, { authKind: "oauth" }>,
  input: Extract<ConnectionCreateInput, { authKind: "oauth" }>,
  secretPath: SecretRef,
): Promise<BuildResult> {
  // Resolve host first — host-parametrized templates (GitHub
  // Enterprise) carry `{host}` placeholders in their URLs and
  // contributions. `input.host` wins, falling back to operator-preset
  // `template.host`.
  const host = input.host ?? template.host;
  const subst = (s: string | undefined): string | undefined =>
    host ? s?.replace(/\{host\}/g, host) : s;

  // Merge user input over template defaults.
  const clientId = input.clientId ?? template.clientId;
  const clientSecret = input.clientSecret ?? template.clientSecret;
  const authorizationUrl =
    input.authorizationUrl ?? subst(template.authorizationUrl);
  const tokenUrl = input.tokenUrl ?? subst(template.tokenUrl);
  const scopes = input.scopes ?? template.scopes ?? [];

  if (!clientId) throw new Error(`template ${template.id}: missing clientId`);
  if (!authorizationUrl || authorizationUrl.includes("{host}")) {
    throw new Error(
      `template ${template.id}: missing authorizationUrl (host: ${host ?? "unset"})`,
    );
  }
  if (!tokenUrl || tokenUrl.includes("{host}")) {
    throw new Error(
      `template ${template.id}: missing tokenUrl (host: ${host ?? "unset"})`,
    );
  }

  const secrets = new Map<string, Record<string, string>>();
  let clientSecretRef: SecretRef | undefined;
  if (input.clientSecret) {
    // User-supplied secret: write to SecretStore, reference per-Connection.
    // (Operator-default secret stays on the in-memory template — the OAuth
    // flow reads it from there at runtime.)
    secrets.set(secretPath.path, { client_secret: input.clientSecret });
    clientSecretRef = { ...secretPath, field: "client_secret" };
  }

  // Substitute `{host}` in static contributions when a host is
  // resolved. Host-parametrized templates rely on this to localize
  // egress hosts and env placeholders to the resolved deployment.
  const contributions: Contribution[] = template.contributions.map((c) =>
    host ? substituteHostInContribution(c, host) : c,
  );

  // GitHub Enterprise host-dependent contributions (ADR-051): GH_HOST
  // env (literal host value — gh CLI uses this to direct API calls to
  // the right server) + api.<host> Bearer egress + <host> Basic egress
  // for git+HTTPS. Mirrors main's GHE flow.
  if (template.id === "github-enterprise") {
    if (!host) throw new Error(`template github-enterprise: missing host`);
    contributions.push({ kind: "env", name: "GH_HOST", placeholder: host });
    contributions.push({ kind: "egress-host", host: `api.${host}` });
    contributions.push({
      kind: "egress-host",
      host,
      injection: {
        headerName: "Authorization",
        valueFormat: "Basic {value}",
        encoding: "basic-x-access-token",
      },
    });
  }

  // App slug surfaces as an opaque per-Connection extra so the UI can
  // surface the post-authorize "Install on GitHub" prompt. User input
  // wins, falling back to the operator-preset extra on the template.
  const appSlug =
    input.appSlug ??
    (typeof template.extras?.appSlug === "string"
      ? template.extras.appSlug
      : undefined);

  return {
    auth: {
      kind: "oauth",
      clientId,
      refreshTokenRef: { ...secretPath, field: "refresh_token" },
      accessTokenRef: { ...secretPath, field: "access_token" },
      scopes,
      authorizationUrl,
      tokenUrl,
      ...(clientSecretRef ? { clientSecretRef } : {}),
      ...(template.tokenEndpointAcceptJson
        ? { tokenEndpointAcceptJson: true }
        : {}),
      ...(template.extraAuthParams
        ? { extraAuthParams: template.extraAuthParams }
        : {}),
      ...(appSlug ? { appSlug } : {}),
      ...(host ? { host } : {}),
    },
    contributions,
    secrets,
    defaultName:
      input.name ?? (host ? `${template.name} (${host})` : template.name),
  };

  // `clientSecret` for the operator-default path stays on the template's
  // in-memory data; oauth-flow reads it from there at flow time. The
  // unused destructure above is intentional documentation.
  // (eslint disable not needed — `clientSecret` is used above.)
}

function substituteHostInContribution(
  c: Contribution,
  host: string,
): Contribution {
  switch (c.kind) {
    case "egress-host":
      return {
        ...c,
        host: c.host.replace(/\{host\}/g, host),
        ...(c.pathPattern
          ? { pathPattern: c.pathPattern.replace(/\{host\}/g, host) }
          : {}),
      };
    case "env":
      return {
        ...c,
        placeholder: c.placeholder.replace(/\{host\}/g, host),
      };
    case "file":
    case "mcp-entry":
    case "skill-ref":
      return c;
  }
}

async function buildOAuthDcr(
  template: Extract<ConnectionTemplate, { authKind: "oauth" }>,
  input: Extract<ConnectionCreateInput, { authKind: "oauth" }>,
  secretPath: SecretRef,
  oauthCallbackUrl: string,
  brandName: string,
): Promise<BuildResult> {
  if (!input.url) {
    throw new Error(
      `template ${template.id}: dynamicRegistration requires a URL`,
    );
  }
  const url = new URL(input.url);
  const meta = await discoverMcpAuth(url);
  if (!meta) {
    throw new Error(`No OAuth discovery metadata at ${input.url}`);
  }
  if (!meta.registrationEndpoint) {
    throw new Error(
      `MCP server at ${input.url} does not support dynamic client registration`,
    );
  }

  const dcr = await registerOAuthClient({
    registrationEndpoint: meta.registrationEndpoint,
    clientName: `${brandName} Agent Platform`,
    redirectUris: [oauthCallbackUrl],
  });

  const secrets = new Map<string, Record<string, string>>();
  const fields: Record<string, string> = {};
  if (dcr.clientSecret) fields.client_secret = dcr.clientSecret;
  if (Object.keys(fields).length > 0) secrets.set(secretPath.path, fields);

  const contributions: Contribution[] = [
    ...template.contributions,
    { kind: "egress-host", host: url.host },
    {
      kind: "mcp-entry",
      name: template.id,
      url: input.url,
      headers: { Authorization: "Bearer dummy-placeholder" },
    },
  ];

  return {
    auth: {
      kind: "oauth",
      clientId: dcr.clientId,
      refreshTokenRef: { ...secretPath, field: "refresh_token" },
      accessTokenRef: { ...secretPath, field: "access_token" },
      scopes: meta.scopes ?? template.scopes ?? [],
      authorizationUrl: meta.authorizationEndpoint,
      tokenUrl: meta.tokenEndpoint,
      ...(dcr.clientSecret
        ? { clientSecretRef: { ...secretPath, field: "client_secret" } }
        : {}),
    },
    contributions,
    secrets,
    defaultName: input.name ?? url.host,
  };
}

function buildHeader(
  template: Extract<ConnectionTemplate, { authKind: "header" }>,
  input: Extract<ConnectionCreateInput, { authKind: "header" }>,
  mintSecretRef: (purpose: string) => SecretRef,
): BuildResult {
  const host = input.host ?? template.host;
  const headerName = input.headerName ?? template.headerName;
  const valueFormat = input.valueFormat ?? template.valueFormat ?? "{value}";
  if (!host) throw new Error(`template ${template.id}: missing host`);
  if (!headerName) {
    throw new Error(`template ${template.id}: missing headerName`);
  }

  const secretPath = mintSecretRef(`connection:${template.id}`);
  const valueRef = { ...secretPath, field: "value" };
  const contributions: Contribution[] = [...template.contributions];

  // User-supplied host always becomes an egress-host (the template's
  // static contributions may already include it; dedupe).
  const hasHostContrib = contributions.some(
    (c) => c.kind === "egress-host" && c.host === host,
  );
  if (!hasHostContrib) {
    contributions.push({ kind: "egress-host", host });
  }

  // Custom MCP (custom mode): user-pasted MCP JSON config rides
  // alongside the header auth. Verbatim into an mcp-entry Contribution;
  // the agent's mcp-entry driver writes it to `.mcp.json`.
  if (input.mcpConfig) {
    const cfg = input.mcpConfig as {
      url?: string;
      headers?: Record<string, string>;
    };
    contributions.push({
      kind: "mcp-entry",
      name: template.id,
      url: cfg.url ?? `https://${host}`,
      headers: cfg.headers ?? { [headerName]: `${valueFormat}` },
    });
  }

  return {
    auth: {
      kind: "header",
      valueRef,
      headerName,
      valueFormat,
    },
    contributions,
    secrets: new Map([[secretPath.path, { value: input.value }]]),
    defaultName: input.name ?? template.name,
  };
}

function buildNone(
  template: Extract<ConnectionTemplate, { authKind: "none" }>,
  input: Extract<ConnectionCreateInput, { authKind: "none" }>,
): BuildResult {
  const contributions: Contribution[] = [...template.contributions];

  if (input.url) {
    const url = new URL(input.url);
    contributions.push({ kind: "egress-host", host: url.host });
    contributions.push({
      kind: "mcp-entry",
      name: template.id,
      url: input.url,
    });
  }

  return {
    auth: { kind: "none" },
    contributions,
    secrets: new Map(),
    defaultName: input.name ?? template.name,
  };
}
