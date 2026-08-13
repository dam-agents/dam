import { z } from "zod";

import { resourceNameSchema } from "../shared.js";

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
  popup: z.boolean().optional(),
});

export const connectionDiscoverMcpInputSchema = z.object({
  url: z.string().url(),
});

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

export const connectionNameSchema = resourceNameSchema("my-mcp-server");

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
  configInputs: z.record(z.string(), z.string()).optional(),
  value: z.string().min(1),
  caData: z.string().optional(),
});

const clientCredentialsCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("client-credentials"),
  host: z.string().min(1).optional(),
  issuerUrl: z.string().url().optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
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

const githubAppCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("github-app"),
  host: z.string().min(1).optional(),
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
  host: z.string().min(1).optional(),
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

const noneCreateInput = z.object({
  ...commonFields,
  authKind: z.literal("none"),
  url: z.string().url().optional(),
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

export const connectionTestAnthropicInputSchema = z.object({
  value: z.string().min(1),
  envName: z.enum(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
});
