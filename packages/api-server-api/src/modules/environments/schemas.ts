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

// UNIT_BOUNDARY_DESCRIPTION: the path on an endpoint that answers 2xx or 3xx once its app is ready, such as `/healthz`; the gate shows its loading page until it does.
export const environmentReadyPathSchema = z
  .string()
  .max(256)
  .regex(
    /^\/[\x21-\x7e]*$/,
    "a path starting with /, of printable characters and no spaces",
  );

export const environmentEndpointSchema = z.object({
  name: environmentEndpointNameSchema,
  port: z.number().int().min(1).max(65535),
  ready: environmentReadyPathSchema.optional(),
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

// UNIT_BOUNDARY_DESCRIPTION: an Agent named on a list by its id, of any owner; the same cap as the people on it.
export const environmentMemberAgentIdsSchema = z
  .array(z.string().trim().min(1).max(253))
  .max(VIEWER_ALLOWLIST_MAX);

// UNIT_BOUNDARY_DESCRIPTION: an Agent on a list, as its owner sees it: who it is and whose, and when it last opened one of the Environments the list covers; an Agent since deleted is not listed.
export const environmentMemberAgentSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  ownerName: z.string().nullable(),
  lastOpenedAt: z.string().nullable(),
});

export const environmentEndpointViewSchema = environmentEndpointSchema.extend({
  url: z.string().nullable(),
});

export const environmentViewSchema = z.object({
  id: z.string(),
  owningAgentId: z.string(),
  name: z.string(),
  endpoints: z.array(environmentEndpointViewSchema),
  members: z.array(z.string()),
  memberAgents: z.array(environmentMemberAgentSchema),
  agentMemberCount: z.number().int(),
  // UNIT_BOUNDARY_DESCRIPTION: when it is deleted; null when it is kept with no expiry, as an artifact's is.
  expiresAt: z.string().nullable(),
  // UNIT_BOUNDARY_DESCRIPTION: how long it may sit idle before it sleeps, or "never"; null when its Agent is gone.
  idleTimeoutMin: z.union([z.number().int(), z.literal("never")]).nullable(),
  createdAt: z.string(),
  state: z.string(),
});

// UNIT_BOUNDARY_DESCRIPTION: an Environment as its owning agent reads it: how many people may open it besides its owner, never who, and its expiry as a date or "never".
export const agentEnvironmentViewSchema = environmentViewSchema
  .omit({ members: true, memberAgents: true, agentMemberCount: true })
  .extend({
    peopleWhoMayOpen: z.number().int(),
    expiresAt: z.union([z.iso.datetime(), z.literal("never")]),
  });

// UNIT_BOUNDARY_DESCRIPTION: an Environment another Agent's list shares with the calling Agent, as that Agent reads it: what it is, whose, and its addresses, never who else may open it.
export const sharedEnvironmentViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  sharedWithYou: z.literal(true),
  owningAgentName: z.string(),
  ownerName: z.string().nullable(),
  endpoints: z.array(environmentEndpointViewSchema),
  expiresAt: z.union([z.iso.datetime(), z.literal("never")]),
  state: z.string(),
});

// UNIT_BOUNDARY_DESCRIPTION: an Agent's Environment Members on its page: its people by email, and its Agents.
export const agentEnvironmentMembersViewSchema = z.object({
  emails: z.array(z.string()),
  agents: z.array(environmentMemberAgentSchema),
});

export const environmentAgentLookupInputSchema = z.object({
  agentId: z.string().trim().min(1).max(253),
});

// UNIT_BOUNDARY_DESCRIPTION: what a person adding an Agent by id is shown before saving: its name and whose it is, or that the id names no Agent that can open an Environment.
export const environmentAgentLookupSchema = z.discriminatedUnion("found", [
  z.object({
    found: z.literal(true),
    agentId: z.string(),
    name: z.string(),
    ownerName: z.string().nullable(),
  }),
  z.object({ found: z.literal(false) }),
]);

export const environmentIdInputSchema = z.object({ id: z.string().min(1) });

export const environmentListInputSchema = z.object({
  owningAgentId: z.string().min(1),
});

export const environmentAgentMembersInputSchema = z.object({
  owningAgentId: z.string().min(1),
  emails: environmentMembersSchema,
  agentIds: environmentMemberAgentIdsSchema.optional(),
});

export const environmentMembersInputSchema = z.object({
  id: z.string().min(1),
  emails: environmentMembersSchema,
  agentIds: environmentMemberAgentIdsSchema.optional(),
});

export const environmentExtendInputSchema = z.object({
  id: z.string().min(1),
  // UNIT_BOUNDARY_DESCRIPTION: the new expiry, or "never" to keep the Environment until someone deletes it.
  expiresAt: z.union([z.iso.datetime(), z.literal("never")]),
});
