import { z } from "zod";

export const connectionIdInputSchema = z.object({
  id: z.string().min(1),
});

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

// Validates a caller-supplied Anthropic credential before it's saved as a
// connection. The envName discriminates api-key (`x-api-key`) vs OAuth
// (`Authorization: Bearer`) so the test request mirrors the real injection.
export const connectionTestAnthropicInputSchema = z.object({
  value: z.string().min(1),
  envName: z.enum(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
});
