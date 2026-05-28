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
import { buildConnectionSdsFields } from "./connection-sds.js";

export interface BuildResult {
  auth: ConnectionAuthConfig;
  contributions: Contribution[];
  secrets: Map<string, Record<string, string>>;
  defaultName: string;
}

export async function buildConnection(
  template: ConnectionTemplate,
  input: ConnectionCreateInput,
  mintSecretRef: (purpose: string) => SecretRef,
  oauthCallbackUrl: string,
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
  const host = input.host ?? template.host;
  const subst = (s: string | undefined): string | undefined =>
    host ? s?.replace(/\{host\}/g, host) : s;

  const clientId = input.clientId ?? template.clientId;
  const authorizationUrl = subst(template.authorizationUrl);
  const tokenUrl = subst(template.tokenUrl);
  const scopes = template.scopes ?? [];

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
    secrets.set(secretPath.path, { client_secret: input.clientSecret });
    clientSecretRef = { ...secretPath, field: "client_secret" };
  }

  const contributions: Contribution[] = template.contributions.map((c) =>
    host ? substituteHostInContribution(c, host) : c,
  );

  if (template.id === "github-enterprise") {
    if (!host) throw new Error(`template github-enterprise: missing host`);
    contributions.push({ kind: "env", name: "GH_HOST", placeholder: host });
    contributions.push({
      kind: "egress-inject",
      host: `api.${host}`,
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    });
    contributions.push({
      kind: "egress-inject",
      host,
      headerName: "Authorization",
      valueFormat: "Basic {value}",
      encoding: "basic-x-access-token",
    });
  }

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
}

function substituteHostInContribution(
  c: Contribution,
  host: string,
): Contribution {
  switch (c.kind) {
    case "egress-allow":
    case "egress-inject":
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
    {
      kind: "egress-inject",
      host: url.host,
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    },
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

  const hasHostContrib = contributions.some(
    (c) =>
      (c.kind === "egress-allow" || c.kind === "egress-inject") &&
      c.host === host,
  );
  if (!hasHostContrib) {
    contributions.push({
      kind: "egress-inject",
      host,
      headerName,
      valueFormat,
    });
  }

  const sdsFields = buildConnectionSdsFields(contributions, input.value);

  return {
    auth: {
      kind: "header",
      valueRef,
      headerName,
      valueFormat,
    },
    contributions,
    secrets: new Map([[secretPath.path, { value: input.value, ...sdsFields }]]),
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
    contributions.push({ kind: "egress-allow", host: url.host });
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
