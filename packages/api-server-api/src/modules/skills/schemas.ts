import { z } from "zod";

// --- Entity / output schemas ---

/** A connected skill source (e.g. a public git repo). */
export const skillSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  gitUrl: z.string(),
  /** True when the source is managed by the cluster admin
   *  (Helm-seeded). Users can't delete it. */
  system: z.boolean().optional(),
  /** Present when the source was declared by an agent template
   *  (spec.skillSources). UI-only hint for the "Agent" badge —
   *  backend treats template sources as read-only. */
  fromTemplate: z
    .object({ templateId: z.string(), templateName: z.string() })
    .optional(),
  /** True when the current user has a publish credential stored for
   *  this source. */
  canPublish: z.boolean().optional(),
});

export const skillPublishResultSchema = z.object({
  prUrl: z.string().url(),
  branch: z.string(),
});

/** A skill available from a connected source. Version is the source's
 *  HEAD commit SHA; contentHash is a deterministic content signature
 *  used for drift detection (see skillRefSchema.contentHash). */
export const skillSchema = z.object({
  source: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  contentHash: z.string(),
});

/** An installed skill on an instance, keyed by source + name. Version
 *  is a commit SHA. */
export const skillRefSchema = z.object({
  source: z.string(),
  name: z.string(),
  version: z.string(),
  /** Deterministic SHA-256 of the skill directory's file contents at
   *  install time. Compared to the scanner's contentHash to flag drift.
   *  Optional for backward compatibility with installs that pre-date
   *  this field. */
  contentHash: z.string().optional(),
});

/** A skill authored directly on the instance's PVC (not installed
 *  from a remote source). */
export const localSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  skillPath: z.string(),
});

// --- Input schemas ---

export const skillListSourcesInputSchema = z
  .object({ agentId: z.string().min(1).optional() })
  .optional();

export const skillCreateSourceInputSchema = z.object({
  name: z.string().min(1).max(128),
  gitUrl: z.string().url(),
});

export const skillDeleteSourceInputSchema = z.object({
  id: z.string().min(1),
});

export const skillRefreshSourceInputSchema = z.object({
  id: z.string().min(1),
});

export const skillListInputSchema = z.object({
  sourceId: z.string().min(1),
  agentId: z.string().min(1).optional(),
});

export const skillInstallInputSchema = z.object({
  agentId: z.string().min(1),
  source: z.string().url(),
  name: z.string().min(1),
  version: z.string().min(1),
  contentHash: z.string().optional(),
});

export const skillUninstallInputSchema = z.object({
  agentId: z.string().min(1),
  source: z.string().url(),
  name: z.string().min(1),
});

export const skillListLocalInputSchema = z.object({
  agentId: z.string().min(1),
});

export const skillStateInputSchema = z.object({
  agentId: z.string().min(1),
});

export const skillPublishInputSchema = z.object({
  agentId: z.string().min(1),
  sourceId: z.string().min(1),
  name: z.string().min(1),
  title: z.string().optional(),
  body: z.string().optional(),
});
