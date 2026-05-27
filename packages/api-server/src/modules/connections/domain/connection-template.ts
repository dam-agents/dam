import type {
  Contribution,
  ConnectionCategory,
  ConnectionTemplateInput,
  ConnectionTemplateView,
} from "api-server-api";

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

export function templateToView(t: ConnectionTemplate): ConnectionTemplateView {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    isCustom: t.isCustom,
    ...(t.description ? { description: t.description } : {}),
    ...(t.iconSlug ? { iconSlug: t.iconSlug } : {}),
    authKind: t.authKind,
    inputs: inputsFor(t),
    ...(t.extras ? { extras: t.extras } : {}),
  };
}

function inputsFor(t: ConnectionTemplate): ConnectionTemplateInput[] {
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
    opts: { secret?: boolean } = {},
  ): ConnectionTemplateInput => ({
    name,
    state: "required",
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
      out.push(
        t.clientId ? overridable("clientId", t.clientId) : required("clientId"),
      );
      out.push(
        t.clientSecret
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
      out.push(required("value", { secret: true }));
      return out;
    }
    case "none":
      return t.category === "mcp" ? [required("url")] : [];
  }
}
