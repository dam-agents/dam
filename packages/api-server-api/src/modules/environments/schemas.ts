import { z } from "zod";
import {
  VIEWER_ALLOWLIST_MAX,
  viewerEmailSchema,
} from "../artifact-library/schemas.js";

export const ENVIRONMENT_EXPIRY_MAX_DAYS = 30;
export const ENVIRONMENT_EXPIRY_DEFAULT_DAYS = 7;

export const environmentNameSchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/,
    "lowercase letters, digits and hyphens, at most 24, starting and ending with a letter or digit",
  );

export const environmentEndpointNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9]{0,11}$/,
    "lowercase letters and digits, at most 12, starting with a letter",
  );

export const environmentEndpointSchema = z.object({
  name: environmentEndpointNameSchema,
  port: z.number().int().min(1).max(65535),
});

export const environmentEndpointsSchema = z
  .array(environmentEndpointSchema)
  .min(1)
  .max(8)
  .refine(
    (endpoints) =>
      new Set(endpoints.map((e) => e.name)).size === endpoints.length,
    "endpoint names must be unique",
  );

// UNIT_BOUNDARY_DESCRIPTION: a list of people by email, at most as many as an artifact's viewers, whose editor the app reuses for it.
export const environmentMembersSchema = z
  .array(viewerEmailSchema)
  .max(VIEWER_ALLOWLIST_MAX);

export const environmentEndpointViewSchema = environmentEndpointSchema.extend({
  url: z.string().nullable(),
});

export const environmentViewSchema = z.object({
  id: z.string(),
  owningAgentId: z.string(),
  name: z.string(),
  endpoints: z.array(environmentEndpointViewSchema),
  members: z.array(z.string()),
  agentMemberCount: z.number().int(),
  expiresAt: z.string(),
  createdAt: z.string(),
  state: z.string(),
});

// UNIT_BOUNDARY_DESCRIPTION: an Environment as its owning agent reads it: how many people may open it besides its owner, never who.
export const agentEnvironmentViewSchema = environmentViewSchema
  .omit({ members: true, agentMemberCount: true })
  .extend({ peopleWhoMayOpen: z.number().int() });

export const environmentIdInputSchema = z.object({ id: z.string().min(1) });

export const environmentListInputSchema = z.object({
  owningAgentId: z.string().min(1),
});

export const environmentAgentMembersInputSchema = z.object({
  owningAgentId: z.string().min(1),
  emails: environmentMembersSchema,
});

export const environmentMembersInputSchema = z.object({
  id: z.string().min(1),
  emails: environmentMembersSchema,
});

export const environmentExtendInputSchema = z.object({
  id: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
