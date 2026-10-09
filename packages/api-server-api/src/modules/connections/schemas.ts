import { z } from "zod";

import { RESERVED_MCP_SERVER_NAMES, resourceNameSchema } from "../shared.js";

const GATEWAY_HOST =
  /^(?:\*\.)?[a-zA-Z0-9](?:[-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?)*$/;

const isGatewayHostname = (hostname: string): boolean =>
  hostname.length <= 253 && GATEWAY_HOST.test(hostname);

export const connectionHostSchema = z
  .string()
  .min(1)
  .refine((raw) => {
    const trimmed = raw.trim();
    try {
      return isGatewayHostname(
        new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
          .hostname,
      );
    } catch {
      return false;
    }
  }, "host must be a DNS hostname or a *.wildcard such as *.example.com, optionally with https:// and a port");

const connectionUrlSchema = z
  .string()
  .url()
  .refine(
    (url) => URL.canParse(url) && isGatewayHostname(new URL(url).hostname),
    "URL host must be a DNS hostname",
  );

export const connectionHeaderNameSchema = z
  .string()
  .regex(
    /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/,
    "header name must be letters, digits or !#$%&'*+-.^_`|~ only, with no spaces or colons",
  );

export const connectionValueFormatSchema = z
  .string()
  .refine(
    (format) => format.includes("{value}"),
    "value format must contain {value} where the secret goes",
  );

export const connectionIdInputSchema = z.object({
  id: z.string().min(1),
});

const connectionCredentialValue = z.object({
  value: z.string().min(1),
});

const connectionCredentialKeyPair = z.object({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
});

export const connectionCredentialUpdateSchema = z.union([
  connectionCredentialValue,
  connectionCredentialKeyPair,
]);
export type ConnectionCredentialUpdate = z.infer<
  typeof connectionCredentialUpdateSchema
>;

export const connectionUpdateInputSchema = z.union([
  connectionIdInputSchema.merge(connectionCredentialValue),
  connectionIdInputSchema.merge(connectionCredentialKeyPair),
]);

export const connectionStartOAuthInputSchema = z.object({
  connectionId: z.string().min(1),
  returnTo: z
    .string()
    .regex(
      /^\/(?!\/)/,
      "returnTo must be a relative path starting with a single /",
    )
    .optional(),
  popup: z.boolean().optional(),
});

export const connectionDiscoverMcpInputSchema = z.object({
  url: z.string().url(),
});

export const connectionProbeClusterCaInputSchema = z.object({
  host: connectionHostSchema,
});

export const connectionGetAgentConnectionsInputSchema = z.object({
  agentId: z.string().min(1),
});

export const connectionSetAgentConnectionsInputSchema = z.object({
  agentId: z.string().min(1),
  connectionIds: z.array(z.string().min(1)),
});

export const connectionSetPreferredConnectionInputSchema = z.object({
  agentId: z.string().min(1),
  connectionId: z.string().min(1),
});

export const connectionNameSchema = resourceNameSchema("my-mcp-server").refine(
  (name) => !RESERVED_MCP_SERVER_NAMES.includes(name),
  {
    message: "that name is reserved for the platform's own tools",
  },
);

const commonFields = {
  templateId: z.string().min(1),
  name: connectionNameSchema,
};

const oauthCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("oauth"),
  url: connectionUrlSchema.optional(),
  host: connectionHostSchema.optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  appSlug: z.string().min(1).optional(),
});

const headerCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("header"),
  host: connectionHostSchema.optional(),
  headerName: connectionHeaderNameSchema.optional(),
  valueFormat: connectionValueFormatSchema.optional(),
  envName: z
    .string()
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "env var name must be letters, digits, and underscores (not starting with a digit)",
    )
    .optional(),
  configInputs: z.record(z.string(), z.string()).optional(),
  value: z.string().min(1),
  caData: z.string().optional(),
});

const sigv4CreateInput = z.object({
  ...commonFields,
  authKind: z.literal("sigv4"),
  endpoint: z.string().min(1),
  region: z.string().min(1).optional(),
  bucket: z.string().min(1).optional(),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
});

const clientCredentialsCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("client-credentials"),
  host: connectionHostSchema.optional(),
  issuerUrl: z.string().url().optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  scopes: z.string().optional(),
  audience: z.string().min(1).optional(),
  headerName: connectionHeaderNameSchema.optional(),
  valueFormat: connectionValueFormatSchema.optional(),
  envName: z
    .string()
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "env var name must be letters, digits, and underscores (not starting with a digit)",
    )
    .optional(),
});

const githubAppCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("github-app"),
  host: connectionHostSchema.optional(),
  appId: z.string().min(1),
  installationId: z.string().min(1),
  privateKey: z.string().min(1),
  repositories: z.string().optional(),
  permissions: z.string().optional(),
  repositoryIds: z.string().optional(),
});

export const connectionProbeGitHubAppInputSchema = z.object({
  templateId: z.string().min(1),
  appId: z.string().min(1),
  installationId: z.string().min(1),
  privateKey: z.string().min(1),
  host: connectionHostSchema.optional(),
});

export const connectionProbeGitHubAppForConnectionInputSchema = z.object({
  connectionId: z.string().min(1),
});

export const connectionUpdateGitHubAppScopeInputSchema = z.object({
  id: z.string().min(1),
  repositories: z.string().optional(),
  repositoryIds: z.string().optional(),
  permissions: z.string().optional(),
});

export const connectionProbeGitHubUserTokenInputSchema = z.object({
  connectionId: z.string().min(1),
});

export const connectionUpdateGitHubUserTokenScopeInputSchema = z.object({
  id: z.string().min(1),
  targetId: z.number().int().positive().optional(),
  repositoryIds: z.string().optional(),
  permissions: z.string().optional(),
});

const noneCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("none"),
  url: connectionUrlSchema.optional(),
  headerName: connectionHeaderNameSchema.optional(),
  value: z.string().min(1).optional(),
});

export const connectionCreateInputSchema = z.discriminatedUnion("authKind", [
  oauthCreateInput,
  clientCredentialsCreateInput,
  githubAppCreateInput,
  headerCreateInput,
  sigv4CreateInput,
  noneCreateInput,
]);
export type ConnectionCreateInput = z.infer<typeof connectionCreateInputSchema>;

export const connectionTestAnthropicInputSchema = z.object({
  value: z.string().min(1),
  envName: z.enum(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
});
