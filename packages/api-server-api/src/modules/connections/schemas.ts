import { z } from "zod";

export const connectionIdInputSchema = z.object({
  id: z.string().min(1),
});

export const connectionStartOAuthInputSchema = z.object({
  connectionId: z.string().min(1),
});

export const connectionDiscoverMcpInputSchema = z.object({
  url: z.string().url(),
});

export const connectionGetAgentConnectionsInputSchema = z.object({
  agentId: z.string().min(1),
});

export const connectionSetAgentConnectionsInputSchema = z.object({
  agentId: z.string().min(1),
  connectionIds: z.array(z.string().min(1)),
});

/**
 * Connection-create input — auth-kind-discriminated (ADR-051). The wire
 * is fully typed: the UI form shape mirrors the template's authKind, and
 * the server projects through the template's static defaults to compute
 * the final Connection record.
 *
 * `templateId` selects which template's defaults and contribution set
 * apply; `authKind` must match the template's authKind (server-side
 * check rejects mismatches).
 */

const commonFields = {
  templateId: z.string().min(1),
  name: z.string().min(1).optional(),
};

/**
 * OAuth inputs. Every field is optional — the template may carry
 * operator-supplied defaults that the user is overriding (or filling
 * in). DCR templates (Custom MCP OAuth) provide just `url`; static
 * templates with operator defaults provide nothing; static templates
 * without operator defaults provide the full set. `buildConnection`
 * merges user input over template defaults and throws if any required
 * field is still blank.
 */
const oauthCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("oauth"),
  url: z.string().url().optional(),
  /** Host-parametrized templates (GitHub Enterprise) use this to derive
   *  authorization/token URLs at build time. Ignored by templates whose
   *  URLs are fixed. */
  host: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  authorizationUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  scopes: z.array(z.string()).optional(),
  /** GitHub App slug. Only meaningful when the OAuth client is a
   *  GitHub App (not an OAuth App). When set, the post-authorize UI
   *  surfaces an "Install on GitHub" prompt. */
  appSlug: z.string().min(1).optional(),
});

/**
 * Header inputs. `value` is always user-supplied (the secret bytes).
 * host / headerName / valueFormat are pre-fillable by the template;
 * the user can override.
 *
 * `mcpConfig` is the optional Custom MCP path: when set, the
 * Connection emits an additional `mcp-entry` Contribution carrying the
 * raw JSON the user pasted. Used for "Custom MCP server (custom)" —
 * platform-injected header auth + agent-side MCP config the user
 * authored.
 */
const headerCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("header"),
  host: z.string().min(1).optional(),
  headerName: z.string().min(1).optional(),
  valueFormat: z.string().min(1).optional(),
  value: z.string().min(1),
  mcpConfig: z.record(z.string(), z.unknown()).optional(),
});

/**
 * No-auth inputs. Currently exercised by no-auth MCP servers — `url` is
 * the only field; the server treats it as both the egress-host source
 * and the mcp-entry URL.
 */
const noneCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("none"),
  url: z.string().url().optional(),
});

export const connectionCreateInputSchema = z.discriminatedUnion("authKind", [
  oauthCreateInput,
  headerCreateInput,
  noneCreateInput,
]);
export type ConnectionCreateInput = z.infer<typeof connectionCreateInputSchema>;
