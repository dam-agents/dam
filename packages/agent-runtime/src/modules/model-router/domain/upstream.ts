import type { ModelDialect } from "../../model-catalog/index.js";

export interface UpstreamCredential {
  header: string;
  value: string;
}

export interface UpstreamWire {
  root: string;
  credential: UpstreamCredential | null;
}

const DIALECT_PATHS: Record<ModelDialect, string> = {
  "anthropic-messages": "/v1/messages",
  "openai-chat": "/v1/chat/completions",
  "openai-responses": "/v1/responses",
};

const stripV1 = (base: string): string =>
  base.replace(/\/+$/, "").replace(/\/v1$/, "");

/**
 * UNIT_BOUNDARY_DESCRIPTION: the credential header must be in the exact form
 * the Connection claims at the credential gateway, carrying the layer's
 * placeholder, so Envoy names the Connection and injects its real key; the
 * router never sees a secret. Null for a template the router does not
 * serve.
 */
export function upstreamWireOf(
  template: string,
  env: Record<string, string>,
): UpstreamWire | null {
  const bearer = (name: string): UpstreamCredential | null =>
    env[name]
      ? { header: "authorization", value: `Bearer ${env[name]}` }
      : null;
  switch (template) {
    case "ibm-litellm":
    case "curve-bender":
    case "curve-bender-deployment": {
      const base = env.OPENAI_BASE_URL ?? env.ANTHROPIC_BASE_URL;
      return base
        ? {
            root: stripV1(base),
            credential:
              bearer("OPENAI_API_KEY") ?? bearer("ANTHROPIC_AUTH_TOKEN"),
          }
        : null;
    }
    case "anthropic":
      return {
        root: stripV1(env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"),
        credential: env.ANTHROPIC_API_KEY
          ? { header: "x-api-key", value: env.ANTHROPIC_API_KEY }
          : null,
      };
    case "anthropic-oauth":
      return {
        root: stripV1(env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"),
        credential: bearer("CLAUDE_CODE_OAUTH_TOKEN"),
      };
    case "openai":
      return {
        root: stripV1(env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"),
        credential: bearer("OPENAI_API_KEY"),
      };
    case "bob": {
      const base = env.BOB_DEFAULT_GATEWAY_URL;
      return base
        ? {
            root: `${base.replace(/\/+$/, "")}/inference`,
            credential: env.BOBSHELL_API_KEY
              ? {
                  header: "authorization",
                  value: `Apikey ${env.BOBSHELL_API_KEY}`,
                }
              : null,
          }
        : null;
    }
    default:
      return null;
  }
}

export function upstreamUrl(
  wire: UpstreamWire,
  dialect: ModelDialect,
  path: string,
  search: string,
): string {
  const dialectPath = DIALECT_PATHS[dialect];
  const suffix = path.startsWith(dialectPath)
    ? path.slice(dialectPath.length)
    : "";
  return `${wire.root}${dialectPath}${suffix}${search}`;
}
