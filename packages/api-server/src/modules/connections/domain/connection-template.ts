import type {
  Contribution,
  ConnectionCategory,
  ConnectionTemplateInput,
  ConnectionTemplateView,
} from "api-server-api";
import { applyCallbackAlias } from "./oauth-callback-url.js";

export type ConnectionTemplate =
  | OAuthConnectionTemplate
  | ClientCredentialsConnectionTemplate
  | GitHubAppConnectionTemplate
  | HeaderConnectionTemplate
  | NoneConnectionTemplate;

interface TemplateCommon {
  id: string;
  name: string;
  category: ConnectionCategory;
  isCustom: boolean;
  description?: string;
  iconSlug?: string;
  contributions: Contribution[];
  extras?: Record<string, unknown>;
}

export interface OAuthConnectionTemplate extends TemplateCommon {
  authKind: "oauth";
  clientId?: string;
  clientSecret?: string;
  host?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  tokenEndpointAcceptJson?: boolean;
  extraAuthParams?: Record<string, string>;
  dynamicRegistration?: boolean;
  setupUrl?: string;
  localhostCallbackAlias?: string;
  credentialFamily?: string;
}

// Client-credentials grant: the platform mints access tokens from the stored
// client secret; the token endpoint (discovered from the issuer's OAuth
// metadata at create time) is dialed server-side, never by the agent.
export interface ClientCredentialsConnectionTemplate extends TemplateCommon {
  authKind: "client-credentials";
  host?: string;
  issuerUrl?: string;
  scopes?: string[];
  audience?: string;
  headerName?: string;
  valueFormat?: string;
  tokenEndpointAcceptJson?: boolean;
}

// GitHub App installation grant: the platform signs a JWT with the app's
// private key and mints installation tokens (ghs_…) at the GitHub REST base
// (`apiBaseUrl`); the token endpoint is dialed server-side, never by the agent.
export interface GitHubAppConnectionTemplate extends TemplateCommon {
  authKind: "github-app";
  host?: string;
  apiBaseUrl?: string;
}

// An optional config input a header template ships; filling it emits an `env` contribution, leaving it blank emits nothing.
export interface ConfigInputSpec {
  inputName: string;
  envName: string;
  label: string;
  hint?: string;
  pattern?: string;
  patternHint?: string;
  enumValues?: readonly string[];
}

export interface HeaderConnectionTemplate extends TemplateCommon {
  authKind: "header";
  host?: string;
  headerName?: string;
  valueFormat?: string;
  configInputs?: ConfigInputSpec[];
}

export interface NoneConnectionTemplate extends TemplateCommon {
  authKind: "none";
}

export interface ConnectionTemplateRegistry {
  list(): ConnectionTemplate[];
  get(id: string): ConnectionTemplate | null;
}

export function createConnectionTemplateRegistry(
  templates: readonly ConnectionTemplate[],
): ConnectionTemplateRegistry {
  const byId = new Map<string, ConnectionTemplate>();
  for (const t of templates) {
    if (byId.has(t.id)) {
      throw new Error(`duplicate Connection Template id: ${t.id}`);
    }
    byId.set(t.id, t);
  }
  return {
    list(): ConnectionTemplate[] {
      return Array.from(byId.values());
    },
    get(id): ConnectionTemplate | null {
      return byId.get(id) ?? null;
    },
  };
}

/** Client credentials a family sibling already registered, surfaced as an
 *  overridable preset on the other family members. */
export interface FamilyCredsPreset {
  clientId: string;
  hasSecret: boolean;
}

/** An OAuth template in a credential family with no operator-baked client id
 *  of its own — it inherits credentials from a connected family sibling. */
export function inheritsFamily(
  t: ConnectionTemplate,
): t is OAuthConnectionTemplate {
  return t.authKind === "oauth" && !!t.credentialFamily && !t.clientId;
}

export function templateToView(
  t: ConnectionTemplate,
  oauthCallbackUrl: string,
  familyPreset?: FamilyCredsPreset,
): ConnectionTemplateView {
  const showsCallbackUrl = t.authKind === "oauth" && !t.dynamicRegistration;
  const alias = t.authKind === "oauth" ? t.localhostCallbackAlias : undefined;
  const extras = {
    ...t.extras,
    ...(t.authKind === "oauth" && t.setupUrl ? { setupUrl: t.setupUrl } : {}),
    ...(showsCallbackUrl
      ? { callbackUrl: applyCallbackAlias(oauthCallbackUrl, alias) }
      : {}),
    ...(familyPreset ? { credentialsFromFamily: true } : {}),
  };
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    isCustom: t.isCustom,
    ...(t.description ? { description: t.description } : {}),
    ...(t.iconSlug ? { iconSlug: t.iconSlug } : {}),
    authKind: t.authKind,
    inputs: inputsFor(t, familyPreset),
    ...(Object.keys(extras).length > 0 ? { extras } : {}),
  };
}

function inputsFor(
  t: ConnectionTemplate,
  familyPreset?: FamilyCredsPreset,
): ConnectionTemplateInput[] {
  const overridable = (
    name: string,
    presetValue?: string,
    opts: { secret?: boolean } = {},
  ): ConnectionTemplateInput => ({
    name,
    state: "overridable",
    ...(presetValue !== undefined && !opts.secret ? { presetValue } : {}),
    ...(opts.secret ? { secret: true } : {}),
  });
  const required = (
    name: string,
    opts: { secret?: boolean; presetValue?: string } = {},
  ): ConnectionTemplateInput => ({
    name,
    state: "required",
    ...(opts.presetValue !== undefined && !opts.secret
      ? { presetValue: opts.presetValue }
      : {}),
    ...(opts.secret ? { secret: true } : {}),
  });
  const optional = (
    name: string,
    presetValue?: string,
  ): ConnectionTemplateInput => ({
    name,
    state: "optional",
    ...(presetValue !== undefined ? { presetValue } : {}),
  });

  switch (t.authKind) {
    case "oauth": {
      // A pre-registered client skips dynamic client registration; endpoints
      // still come from the server's OAuth discovery metadata.
      if (t.dynamicRegistration)
        return [
          required("url"),
          optional("clientId"),
          { name: "clientSecret", state: "optional", secret: true },
        ];
      const out: ConnectionTemplateInput[] = [];

      const urlsHavePlaceholder =
        (t.authorizationUrl?.includes("{host}") ?? false) ||
        (t.tokenUrl?.includes("{host}") ?? false);
      if (urlsHavePlaceholder) {
        out.push(t.host ? overridable("host", t.host) : required("host"));
      }
      // A family sibling's creds (familyPreset) stand in when this template
      // has no operator-baked client id, surfacing both as overridable.
      const clientId = t.clientId ?? familyPreset?.clientId;
      out.push(
        clientId ? overridable("clientId", clientId) : required("clientId"),
      );
      const hasSecret = !!t.clientSecret || (familyPreset?.hasSecret ?? false);
      out.push(
        hasSecret
          ? overridable("clientSecret", undefined, { secret: true })
          : required("clientSecret", { secret: true }),
      );
      if (t.id === "github" || t.id === "github-enterprise") {
        const presetAppSlug =
          typeof t.extras?.appSlug === "string" ? t.extras.appSlug : undefined;
        out.push(
          presetAppSlug
            ? overridable("appSlug", presetAppSlug)
            : optional("appSlug"),
        );
      }
      return out;
    }
    case "client-credentials":
      // Same visible pre-filled style as the custom header credential.
      return [
        required("host", { presetValue: t.host }),
        {
          name: "issuerUrl",
          state: "optional",
          ...(t.issuerUrl !== undefined ? { presetValue: t.issuerUrl } : {}),
          hint: "Leave blank to discover the authorization server from the host.",
        },
        required("clientId"),
        required("clientSecret", { secret: true }),
        optional("scopes"),
        optional("audience"),
        required("headerName", { presetValue: t.headerName }),
        required("valueFormat", { presetValue: t.valueFormat }),
        optional("envName"),
      ];
    case "github-app": {
      const out: ConnectionTemplateInput[] = [];
      // Only a host-parameterized template (its apiBaseUrl carries a
      // `{host}` placeholder, e.g. the GitHub Enterprise sibling) asks for a
      // host — the fixed github.com template has nothing to substitute.
      if (t.apiBaseUrl?.includes("{host}")) {
        out.push(t.host ? overridable("host", t.host) : required("host"));
      }
      out.push(
        {
          name: "appId",
          state: "required",
          label: "App ID",
          hint: "Your GitHub App's numeric App ID (Settings → Developer settings → GitHub Apps → your app).",
        },
        {
          name: "installationId",
          state: "required",
          label: "Installation ID",
          hint: "The installation to mint tokens for — the number at the end of the installation's settings URL (…/installations/<id>).",
        },
        {
          name: "privateKey",
          state: "required",
          secret: true,
          multiline: true,
          label: "Private key (PEM)",
          hint: "A private key generated for the app (.pem). Paste the whole file including the BEGIN/END lines, or its base64 encoding.",
        },
        {
          name: "repositories",
          state: "optional",
          label: "Limit to repositories",
          hint: "Repository names, separated by spaces or commas — just the name, not owner/name. Leave blank for every repository the installation can reach.",
        },
        {
          name: "permissions",
          state: "optional",
          label: "Limit to permissions",
          hint: "Pairs like contents:read, issues:write. Leave blank for every permission the app was granted. You can only narrow what the installation already allows.",
        },
      );
      return out;
    }
    case "header": {
      const out: ConnectionTemplateInput[] = [];
      if (t.isCustom) {
        // Custom credential: visible pre-filled inputs, not the operator
        // "Customize defaults" accordion.
        out.push(required("host", { presetValue: t.host }));
        out.push(required("headerName", { presetValue: t.headerName }));
        out.push(required("valueFormat", { presetValue: t.valueFormat }));
      } else {
        if (t.id === "kubernetes") {
          out.push({
            name: "host",
            state: "required",
            label: "API server URL",
            hint: "The cluster API endpoint, exactly as you'd pass to `oc login` / `kubectl` — e.g. https://api.my-cluster.example:6443. A bare host[:port] works too.",
          });
        } else {
          out.push(t.host ? overridable("host", t.host) : required("host"));
        }
        out.push(
          t.headerName
            ? overridable("headerName", t.headerName)
            : required("headerName"),
        );
        out.push(
          t.valueFormat
            ? overridable("valueFormat", t.valueFormat)
            : required("valueFormat"),
        );
      }
      out.push(required("value", { secret: true }));
      // CA is public material (not secret) and optional per endpoint.
      if (t.id === "kubernetes") {
        out.push({
          name: "caData",
          state: "optional",
          label: "Cluster CA certificate",
          hint: "Leave blank for a publicly-trusted API endpoint (most managed clusters). For a private or self-signed CA, paste certificate-authority-data from your kubeconfig (base64 or PEM).",
        });
      }
      // Custom credential can also be exposed to the agent as an env var
      // (placeholder in-pod; Envoy injects the real value on egress).
      if (t.isCustom) out.push(optional("envName"));
      for (const spec of t.configInputs ?? []) {
        out.push({
          name: spec.inputName,
          state: "optional",
          configInput: true,
          label: spec.label,
          ...(spec.hint ? { hint: spec.hint } : {}),
          ...(spec.pattern ? { pattern: spec.pattern } : {}),
          ...(spec.patternHint ? { patternHint: spec.patternHint } : {}),
          ...(spec.enumValues ? { enumValues: [...spec.enumValues] } : {}),
        });
      }
      return out;
    }
    case "none":
      // Custom MCP servers may carry an optional header credential (API
      // key) injected at the gateway.
      return t.category === "mcp"
        ? [
            required("url"),
            optional("headerName"),
            { name: "value", state: "optional", secret: true },
          ]
        : [];
  }
}
