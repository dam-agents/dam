import type {
  ConnectionAuthConfig,
  ConnectionCreateInput,
  Contribution,
  SecretRef,
} from "api-server-api";
import type { ConnectionTemplate } from "./connection-template.js";
import {
  discoverIssuerFromResourceHost,
  discoverIssuerMetadata,
  discoverMcpAuth,
  registerOAuthClient,
} from "../infrastructure/mcp-discovery.js";
import {
  buildConnectionSdsFields,
  CONNECTION_TOKEN_PLACEHOLDER,
  UPSTREAM_CA_SECRET_FIELD,
} from "./connection-sds.js";
import {
  buildKubernetesContributions,
  decodeCaData,
  KUBERNETES_TEMPLATE_ID,
  parseClusterEndpoint,
} from "./kubernetes-contributions.js";

export interface BuildResult {
  auth: ConnectionAuthConfig;
  contributions: Contribution[];
  secrets: Map<string, Record<string, string>>;
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
    case "client-credentials":
      return buildClientCredentials(
        template as Extract<
          ConnectionTemplate,
          { authKind: "client-credentials" }
        >,
        input,
        mintSecretRef,
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
  };
}

// Resolves the token endpoint from the issuer's OAuth metadata (like the DCR
// path above, discovery runs at build time so a bad issuer fails the create).
// The secret map carries only the client secret: the access token (and the
// SDS files baked from it) is minted by the service before the secret write.
async function buildClientCredentials(
  template: Extract<ConnectionTemplate, { authKind: "client-credentials" }>,
  input: Extract<ConnectionCreateInput, { authKind: "client-credentials" }>,
  mintSecretRef: (purpose: string) => SecretRef,
): Promise<BuildResult> {
  const rawHost = input.host ?? template.host;
  if (!rawHost) throw new Error(`template ${template.id}: missing host`);
  const { host, port } = parseClusterEndpoint(rawHost);

  const subst = (s: string | undefined): string | undefined =>
    s?.replace(/\{host\}/g, host);
  const explicitIssuer = subst(input.issuerUrl ?? template.issuerUrl);

  let issuerUrl: string;
  let issuerMeta: { tokenEndpoint: string; grantTypesSupported?: string[] };
  if (explicitIssuer) {
    const meta = await discoverIssuerMetadata(explicitIssuer);
    if (!meta) {
      throw new Error(
        `No OAuth authorization-server metadata found at ${explicitIssuer} — check that it is the issuer URL (its /.well-known/openid-configuration or /.well-known/oauth-authorization-server must resolve)`,
      );
    }
    issuerUrl = explicitIssuer;
    issuerMeta = meta;
  } else {
    const origin = `https://${host}${port ? `:${port}` : ""}`;
    const derived = await discoverIssuerFromResourceHost(origin);
    if (!derived) {
      throw new Error(
        `Couldn't discover an authorization server from ${origin} — supply the issuer URL explicitly`,
      );
    }
    issuerUrl = derived.issuerUrl;
    issuerMeta = derived;
  }
  // grant_types_supported is optional metadata (many issuers omit it) —
  // absence is deliberately treated as supported.
  if (
    issuerMeta.grantTypesSupported &&
    !issuerMeta.grantTypesSupported.includes("client_credentials")
  ) {
    throw new Error(
      `The authorization server at ${issuerUrl} does not support the client_credentials grant`,
    );
  }
  const clientId = input.clientId;
  if (!clientId) throw new Error(`template ${template.id}: missing clientId`);
  if (!input.clientSecret) {
    throw new Error(`template ${template.id}: missing clientSecret`);
  }
  const headerName = input.headerName ?? template.headerName ?? "Authorization";
  const valueFormat =
    input.valueFormat ?? template.valueFormat ?? "Bearer {value}";
  const scopes =
    input.scopes
      ?.split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean) ??
    template.scopes ??
    [];
  const audience = input.audience ?? template.audience;

  const secretPath = mintSecretRef(`connection:${template.id}`);
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
      ...(port ? { port } : {}),
      headerName,
      valueFormat,
    });
  }

  if (input.envName) {
    contributions.push({
      kind: "env",
      name: input.envName,
      placeholder: CONNECTION_TOKEN_PLACEHOLDER,
    });
  }

  return {
    auth: {
      kind: "client-credentials",
      clientId,
      clientSecretRef: { ...secretPath, field: "client_secret" },
      accessTokenRef: { ...secretPath, field: "access_token" },
      issuerUrl,
      tokenUrl: issuerMeta.tokenEndpoint,
      scopes,
      ...(audience ? { audience } : {}),
      ...(template.tokenEndpointAcceptJson
        ? { tokenEndpointAcceptJson: true }
        : {}),
      host,
    },
    contributions,
    secrets: new Map([
      [secretPath.path, { client_secret: input.clientSecret }],
    ]),
  };
}

function buildHeader(
  template: Extract<ConnectionTemplate, { authKind: "header" }>,
  input: Extract<ConnectionCreateInput, { authKind: "header" }>,
  mintSecretRef: (purpose: string) => SecretRef,
): BuildResult {
  const rawHost = input.host ?? template.host;
  const headerName = input.headerName ?? template.headerName;
  const valueFormat = input.valueFormat ?? template.valueFormat ?? "{value}";
  if (!rawHost) throw new Error(`template ${template.id}: missing host`);
  if (!headerName) {
    throw new Error(`template ${template.id}: missing headerName`);
  }
  const { host, port } = parseClusterEndpoint(rawHost);
  const caPem = input.caData ? decodeCaData(input.caData) : undefined;

  const secretPath = mintSecretRef(`connection:${template.id}`);
  const valueRef = { ...secretPath, field: "value" };
  const contributions: Contribution[] = [...template.contributions];

  if (template.id === KUBERNETES_TEMPLATE_ID) {
    contributions.push(
      ...buildKubernetesContributions({
        name: input.name,
        host,
        port,
        hasUpstreamCa: !!caPem,
      }),
    );
  }

  const hasHostContrib = contributions.some(
    (c) =>
      (c.kind === "egress-allow" || c.kind === "egress-inject") &&
      c.host === host,
  );
  if (!hasHostContrib) {
    contributions.push({
      kind: "egress-inject",
      host,
      ...(port ? { port } : {}),
      headerName,
      valueFormat,
      ...(caPem ? { upstreamCa: true } : {}),
    });
  }

  if (input.envName) {
    contributions.push({
      kind: "env",
      name: input.envName,
      placeholder: CONNECTION_TOKEN_PLACEHOLDER,
    });
  }

  // Each filled config input becomes an `env` contribution.
  for (const spec of template.configInputs ?? []) {
    const value = input.configInputs?.[spec.inputName]?.trim();
    if (!value) continue;
    if (spec.pattern && !new RegExp(`^(?:${spec.pattern})$`).test(value)) {
      throw new Error(`${spec.label}: "${value}" is not valid`);
    }
    if (spec.enumValues && !spec.enumValues.includes(value)) {
      throw new Error(
        `${spec.label}: must be one of ${spec.enumValues.join(", ")}`,
      );
    }
    contributions.push({ kind: "env", name: spec.envName, placeholder: value });
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
    secrets: new Map([
      [
        secretPath.path,
        {
          value: input.value,
          ...(caPem ? { [UPSTREAM_CA_SECRET_FIELD]: caPem } : {}),
          ...sdsFields,
        },
      ],
    ]),
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
  };
}
