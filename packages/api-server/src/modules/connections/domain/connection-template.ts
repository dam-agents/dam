import type {
  Contribution,
  ConnectionCategory,
  ConnectionTemplateInput,
  ConnectionTemplateView,
} from "api-server-api";
import { applyCallbackAlias } from "./oauth-callback-url.js";

export type ConnectionTemplate =
  | OAuthConnectionTemplate
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

export interface HeaderConnectionTemplate extends TemplateCommon {
  authKind: "header";
  host?: string;
  headerName?: string;
  valueFormat?: string;
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
      if (t.dynamicRegistration) return [required("url")];
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
    case "header": {
      const out: ConnectionTemplateInput[] = [];
      if (t.isCustom) {
        // Custom credential: visible pre-filled inputs, not the operator
        // "Customize defaults" accordion.
        out.push(required("host", { presetValue: t.host }));
        out.push(required("headerName", { presetValue: t.headerName }));
        out.push(required("valueFormat", { presetValue: t.valueFormat }));
      } else {
        out.push(t.host ? overridable("host", t.host) : required("host"));
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
      // Custom credential can also be exposed to the agent as an env var
      // (placeholder in-pod; Envoy injects the real value on egress).
      if (t.isCustom) out.push(optional("envName"));
      return out;
    }
    case "none":
      return t.category === "mcp" ? [required("url")] : [];
  }
}
