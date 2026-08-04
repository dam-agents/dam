import { z } from "zod";

export const skillInstallInputSchema = z.object({
  sourceUrl: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  skillPaths: z.array(z.string().min(1)).min(1),
  path: z.string().optional(),
});

export const skillUninstallInputSchema = z.object({
  name: z.string().min(1),
  skillPaths: z.array(z.string().min(1)).min(1),
});

export const skillScanInputSchema = z.object({
  source: z.string().min(1),
  path: z.string().optional(),
});

// No skillPaths: the agent-runtime resolves them from its manifest.
export const skillPublishInputSchema = z.object({
  name: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  // Source subdir the skill is published into; mirrors the scanner so a
  // subdir source's own scan finds what was published back to it.
  path: z.string().optional(),
});

export const skillListLocalInputSchema = z.object({
  /** Names to compute `contentHash` for. Hashing walks the whole skill dir on
   *  an NFS-backed PVC and this runs on every state poll, so the caller asks
   *  only for the few skills it needs it for (#3019). */
  hashNames: z.array(z.string()).optional(),
});

export const skillReadLocalInputSchema = z.object({
  name: z.string().min(1),
});

// Coordinates, not the pull-request URL: the api-server has already parsed it
// (and resolves owner/repo the same way for publish), so parsing it a second
// time in the pod would be a duplicate implementation waiting to drift.
export const skillReadPullRequestInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
});

// No skillPaths: the runtime resolves them from its manifest, same as
// readLocal/writeLocal. (Contrast skillUninstallInputSchema, whose paths come
// from the driver applying a declarative install.)
export const skillDeleteLocalInputSchema = z.object({
  name: z.string().min(1),
});

export const skillWriteLocalInputSchema = z.object({
  skills: z
    .array(
      z.object({
        /** Confirmed display name — becomes frontmatter `name:`; the dir is its slug. */
        name: z.string().min(1).max(128),
        /** Raw Markdown file content; lands as SKILL.md. */
        content: z.string(),
      }),
    )
    .min(1)
    .max(50),
});
