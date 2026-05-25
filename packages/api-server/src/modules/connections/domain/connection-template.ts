import type {
  Contribution,
  ConnectionCategory,
  ConnectionTemplateInput,
  ConnectionTemplateView,
} from "api-server-api";

/**
 * Connection Template (ADR-051) — code-declared catalog entry. Templates
 * are *data*, not code: one auth kind per template, declarative defaults
 * (host / headerName / valueFormat for `header`; clientId / scopes /
 * endpoints for `oauth`), declarative contributions emitted on grant.
 *
 * `domain/build-connection.ts` carries the single generic projection
 * function. Adding a new app or provider is one block in
 * `domain/catalog.ts`.
 */
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
  /** Static contributions emitted on every grant. Custom templates also
   *  emit dynamic contributions derived from user input (egress-host for
   *  Custom Header's user-supplied host; mcp-entry + egress-host for the
   *  Custom MCP URL). */
  contributions: Contribution[];
  /** Per-template metadata that doesn't belong on the wire-shape proper.
   *  GitHub's `appSlug` lives here so the core template type stays clean —
   *  the UI keys on `extras[<key>]` for one-off affordances (install
   *  prompt for GitHub Apps, etc.). Opaque to the build pipeline. */
  extras?: Record<string, unknown>;
}

export interface OAuthConnectionTemplate extends TemplateCommon {
  authKind: "oauth";
  /** Operator-supplied defaults. When absent, the user supplies these at
   *  create time; the wire input schema accepts the same fields as
   *  optional. Either source must populate them before the flow can
   *  start — `buildConnection` throws if both are blank. */
  clientId?: string;
  clientSecret?: string;
  /** Operator-preset host for host-parametrized templates (GitHub
   *  Enterprise). When present, `authorizationUrl` / `tokenUrl` are
   *  expected to already have the host baked in; when absent, the URLs
   *  may carry `{host}` placeholders that `buildConnection` substitutes
   *  with `input.host`. */
  host?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  /** GitHub returns form-encoded by default; opt-in JSON. */
  tokenEndpointAcceptJson?: boolean;
  /** Provider-specific authorize-URL params. */
  extraAuthParams?: Record<string, string>;
  /**
   * Dynamic Client Registration (RFC 7591). Set on templates whose
   * endpoints + client identity come from `.well-known` discovery at
   * the user-supplied URL — Custom MCP OAuth specifically. When true,
   * `buildConnection` runs discovery + DCR against `input.url`,
   * persists the registered client_secret per-Connection in
   * SecretStore via `clientSecretRef`, and stamps the discovered
   * endpoints into the Connection's auth.
   *
   * Mutually exclusive with static `clientId` / endpoints — DCR
   * templates leave those blank.
   */
  dynamicRegistration?: boolean;
}

export interface HeaderConnectionTemplate extends TemplateCommon {
  authKind: "header";
  /** Pre-filled defaults the template hard-codes. User input can override
   *  on Custom Header; static templates (Anthropic, OpenAI) hard-code
   *  them and the UI form omits the fields. */
  host?: string;
  headerName?: string;
  valueFormat?: string;
}

export interface NoneConnectionTemplate extends TemplateCommon {
  authKind: "none";
}

// ─── Registry ─────────────────────────────────────────────────────────────

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

// ─── View projection (for UI catalog listing) ─────────────────────────────

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

/**
 * Builds the UI's per-field state machine for a template (ADR-051).
 * Each field that the template's `build()` may consume becomes a
 * `ConnectionTemplateInput` carrying one of three states:
 *
 *   - `required`     — no operator preset, no fallback; UI must collect.
 *   - `overridable`  — operator preset present; UI hides behind a
 *                      "Customize" toggle, with the preset value
 *                      surfaced as `presetValue` for non-secret fields.
 *   - `optional`     — no preset, no fallback, user may skip.
 *
 * The list order is render order. Secret fields (clientSecret, the
 * `value` byte of a header credential) carry `secret: true` and never
 * have a `presetValue` — the UI renders them as password inputs.
 */
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

      // Host-parametrized templates (GitHub Enterprise) signal "needs
      // host" by leaving `template.host` unset while their
      // authorizationUrl / tokenUrl carry `{host}` placeholders.
      const urlsHavePlaceholder =
        (t.authorizationUrl?.includes("{host}") ?? false) ||
        (t.tokenUrl?.includes("{host}") ?? false);
      if (urlsHavePlaceholder) {
        out.push(t.host ? overridable("host", t.host) : required("host"));
      }
      out.push(
        t.clientId ? overridable("clientId", t.clientId) : required("clientId"),
      );
      // clientSecret is overridable when an operator default exists,
      // but the preset bytes never echo to the UI — only the override
      // affordance does.
      out.push(
        t.clientSecret
          ? overridable("clientSecret", undefined, { secret: true })
          : required("clientSecret", { secret: true }),
      );
      if (!t.authorizationUrl) out.push(required("authorizationUrl"));
      if (!t.tokenUrl) out.push(required("tokenUrl"));
      if (!t.scopes) out.push(required("scopes"));

      // GitHub App slug — only meaningful for github / github-enterprise.
      // Optional even with operator preset: an operator can wire OAuth
      // App credentials and the field is just absent, or wire GitHub
      // App credentials and the field is set.
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
      // `value` is the secret bytes; always user-supplied, never preset.
      out.push(required("value", { secret: true }));
      return out;
    }
    case "none":
      // MCP-no-auth templates need the URL; others need nothing.
      return t.category === "mcp" ? [required("url")] : [];
  }
}
