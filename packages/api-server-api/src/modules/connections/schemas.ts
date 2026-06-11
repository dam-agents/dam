import { z } from "zod";

export const connectionIdInputSchema = z.object({
  id: z.string().min(1),
});

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
