import { z } from "zod";

export const connectionIdInputSchema = z.object({
  id: z.string().min(1),
});

// `value` is whichever secret the connection's auth kind stores.
export const connectionUpdateInputSchema = z.object({
  id: z.string().min(1),
  value: z.string().min(1),
});
export type ConnectionUpdateInput = z.infer<typeof connectionUpdateInputSchema>;

export const connectionStartOAuthInputSchema = z.object({
  connectionId: z.string().min(1),
  returnTo: z
    .string()
    .regex(
      /^\/(?!\/)/,
      "returnTo must be a relative path starting with a single /",
    )
    .optional(),
  // When set, the callback returns a page that postMessages the result to the
  // opener and closes, instead of redirecting. Used by the popup OAuth flow.
  popup: z.boolean().optional(),
});

export const connectionDiscoverMcpInputSchema = z.object({
  url: z.string().url(),
});

// Probe an API server's TLS so the UI/CLI can tell a publicly-trusted endpoint
// (no CA needed) from one that requires an explicit CA paste (host may carry a
// `:port`).
export const connectionProbeClusterCaInputSchema = z.object({
  host: z.string().min(1),
});

export const connectionGetAgentConnectionsInputSchema = z.object({
  agentId: z.string().min(1),
});

export const connectionSetAgentConnectionsInputSchema = z.object({
  agentId: z.string().min(1),
  connectionIds: z.array(z.string().min(1)),
});

export const connectionNameSchema = z
  .string()
  .min(1, "name is required")
  .max(63, "name must be 63 characters or fewer")
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "name must be lowercase letters, digits, and single hyphens (e.g. my-mcp-server)",
  );

const commonFields = {
  templateId: z.string().min(1),
  name: connectionNameSchema,
};

const oauthCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("oauth"),
  url: z.string().url().optional(),
  host: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  appSlug: z.string().min(1).optional(),
});

const headerCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("header"),
  host: z.string().min(1).optional(),
  headerName: z.string().min(1).optional(),
  valueFormat: z.string().min(1).optional(),
  envName: z
    .string()
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "env var name must be letters, digits, and underscores (not starting with a digit)",
    )
    .optional(),
  // Values for the template's declared config inputs, keyed by input name.
  configInputs: z.record(z.string(), z.string()).optional(),
  value: z.string().min(1),
  // Upstream CA bundle for hosts whose TLS cert a public root can't verify
  // (self-signed cluster CAs). PEM, or base64 of PEM (kubeconfig
  // `certificate-authority-data`).
  caData: z.string().optional(),
});

// Like oauthCreateInput, fields a template may preset are optional here and
// enforced at build time against the template's own values.
const clientCredentialsCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("client-credentials"),
  host: z.string().min(1).optional(),
  // The token endpoint is discovered from the issuer's OAuth metadata.
  issuerUrl: z.string().url().optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  // Space- or comma-separated; the server splits. A single string keeps the
  // schema-driven forms all-string.
  scopes: z.string().optional(),
  audience: z.string().min(1).optional(),
  headerName: z.string().min(1).optional(),
  valueFormat: z.string().min(1).optional(),
  envName: z
    .string()
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "env var name must be letters, digits, and underscores (not starting with a digit)",
    )
    .optional(),
});

// GitHub App installation credential: the app's numeric identity plus a private
// key. The key is accepted as raw PEM or its base64 encoding (see the build
// step); the platform mints installation tokens from it server-side. `host`
// is only meaningful for a template whose REST base is host-parameterized
// (a GitHub Enterprise installation) — ignored otherwise.
const githubAppCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("github-app"),
  host: z.string().min(1).optional(),
  appId: z.string().min(1),
  installationId: z.string().min(1),
  privateKey: z.string().min(1),
  // Optional narrowing of the minted token. Space- or comma-separated; the
  // server parses both. Single strings keep the schema-driven forms all-string,
  // as client-credentials `scopes` does. Blank leaves the token with the
  // installation's full authority.
  repositories: z.string().optional(),
  permissions: z.string().optional(),
  // Repository ids, as picked from the installation. Same all-string shape as
  // the sibling fields; ids take precedence over names when both arrive.
  repositoryIds: z.string().optional(),
});

// Reads an installation's granted repositories and permissions before create,
// so the form can offer them. Carries the private key for one request and
// stores nothing — the same secret the create call is about to send anyway.
export const connectionProbeGitHubAppInputSchema = z.object({
  templateId: z.string().min(1),
  appId: z.string().min(1),
  installationId: z.string().min(1),
  privateKey: z.string().min(1),
  host: z.string().min(1).optional(),
});

// The same read for an existing connection, which supplies its own app
// identity and key — so editing never asks for the private key again.
export const connectionProbeGitHubAppForConnectionInputSchema = z.object({
  connectionId: z.string().min(1),
});

// Replaces a github-app connection's narrowing. Same all-string shape as
// create; an omitted or blank field clears that half rather than leaving the
// previous value in place, so the form always states the whole scope.
export const connectionUpdateGitHubAppScopeInputSchema = z.object({
  id: z.string().min(1),
  repositories: z.string().optional(),
  repositoryIds: z.string().optional(),
  permissions: z.string().optional(),
});

const noneCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("none"),
  url: z.string().url().optional(),
  // Optional header credential (API key) for MCP servers guarded by a
  // static header — injected at the gateway, never written to harness config.
  headerName: z.string().min(1).optional(),
  value: z.string().min(1).optional(),
});

export const connectionCreateInputSchema = z.discriminatedUnion("authKind", [
  oauthCreateInput,
  clientCredentialsCreateInput,
  githubAppCreateInput,
  headerCreateInput,
  noneCreateInput,
]);
export type ConnectionCreateInput = z.infer<typeof connectionCreateInputSchema>;

// Validates a caller-supplied Anthropic credential before it's saved as a
// connection. The envName discriminates api-key (`x-api-key`) vs OAuth
// (`Authorization: Bearer`) so the test request mirrors the real injection.
export const connectionTestAnthropicInputSchema = z.object({
  value: z.string().min(1),
  envName: z.enum(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
});
