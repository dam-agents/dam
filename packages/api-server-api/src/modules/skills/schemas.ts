import { z } from "zod";

import { resourceNameSchema } from "../shared.js";

export const skillSourcePathSchema = z
  .string()
  .transform((p) => p.trim().replace(/^\/+|\/+$/g, ""))
  .refine((p) => !p.split("/").includes(".."), "path must not contain '..'");

export const skillSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  gitUrl: z.string(),
  path: z.string().optional(),
  system: z.boolean().optional(),
  fromTemplate: z
    .object({ templateId: z.string(), templateName: z.string() })
    .optional(),
  canPublish: z.boolean().optional(),
});

export const skillPublishResultSchema = z.object({
  prUrl: z.string().url(),
  branch: z.string(),
});

export const skillSchema = z.object({
  source: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  contentHash: z.string(),
  dir: z.string().optional(),
});

export const skillListResultSchema = z.object({
  skills: z.array(skillSchema),
  scannedAt: z.string().datetime(),
  visibility: z.enum(["public", "private"]).optional(),
});

export const scanFailureCodes = [
  "needs_github_connection",
  "needs_sandbox",
  "repo_unreachable",
  "agent_unreachable",
  "source_path_not_found",
  "source_path_empty",
  "other",
] as const;

export const scanFailureSchema = z.object({
  code: z.enum(scanFailureCodes),
  title: z.string(),
  detail: z.string(),
});

export const skillRefSchema = z.object({
  source: z.string(),
  name: z.string(),
  version: z.string(),
  contentHash: z.string().optional(),
  path: z.string().optional(),
});

export const localSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  skillPath: z.string(),
  origin: z.enum(["system", "system-modified", "user"]).optional(),
  contentHash: z.string().optional(),
});

export const skillPublishRecordSchema = z.object({
  skillName: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  sourceGitUrl: z.string(),
  prUrl: z.string(),
  publishedAt: z.string(),
  prState: z.enum(["draft", "open", "merged", "closed"]).nullable(),
  prStateCheckedAt: z.string().nullable(),
});

export const skillStateOutputSchema = z.object({
  installed: z.array(skillRefSchema),
  standalone: z.array(localSkillSchema),
  instancePublishes: z.array(skillPublishRecordSchema),
  standaloneSnapshot: z
    .object({ capturedAt: z.string().datetime() })
    .optional(),
});

export const skillListSourcesInputSchema = z
  .object({ agentId: z.string().min(1).optional() })
  .optional();

export const skillCreateSourceInputSchema = z.object({
  name: z.string().min(1).max(128),
  gitUrl: z.string().url(),
  path: skillSourcePathSchema.optional(),
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

export const skillGetContentInputSchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  agentId: z.string().min(1).optional(),
});

export const skillContentSchema = z.object({
  content: z.string(),
  dir: z.string().optional(),
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

export const skillSetEntrySchema = z.object({
  source: z.string().url(),
  name: z.string().min(1),
});

export const skillKey = (e: { source: string; name: string }) =>
  `${e.source}::${e.name}`;

export const skillSetNameSchema = resourceNameSchema("my-skill-set");

export const skillSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  skills: z.array(skillSetEntrySchema),
  createdAt: z.string(),
});

export const skillSetCreateInputSchema = z.object({
  name: skillSetNameSchema,
  skills: z.array(skillSetEntrySchema).min(1).max(500),
});

export const skillSetDeleteInputSchema = z.object({ id: z.string().min(1) });

export const skillSetApplyInputSchema = z.object({
  agentId: z.string().min(1),
  setIds: z.array(z.string().min(1)).min(1).max(50),
});

export const skillSetSkipReasonSchema = z.enum([
  "source-not-connected",
  "source-unreadable",
  "not-in-source",
]);

export const skillSetApplyResultSchema = z.object({
  installed: z.array(skillRefSchema),
  added: z.number().int().nonnegative(),
  skipped: z.array(
    skillSetEntrySchema.extend({ reason: skillSetSkipReasonSchema }),
  ),
});

export const MAX_SKILL_BATCH_ENTRIES = 500;

export const skillApplyBatchInputSchema = z
  .object({
    agentId: z.string().min(1),
    install: z
      .array(
        z.object({
          source: z.string().url(),
          name: z.string().min(1),
          version: z.string().min(1),
          contentHash: z.string().optional(),
        }),
      )
      .max(MAX_SKILL_BATCH_ENTRIES)
      .default([]),
    uninstall: z
      .array(
        z.object({
          source: z.string().url(),
          name: z.string().min(1),
        }),
      )
      .max(MAX_SKILL_BATCH_ENTRIES)
      .default([]),
  })
  .refine(
    (v) => v.install.length + v.uninstall.length <= MAX_SKILL_BATCH_ENTRIES,
    {
      message: `one batch carries at most ${MAX_SKILL_BATCH_ENTRIES} skills, install and uninstall combined`,
    },
  );

export const skillListLocalInputSchema = z.object({
  agentId: z.string().min(1),
});

export const skillStateInputSchema = z.object({
  agentId: z.string().min(1),
});

export const skillDeleteLocalInputSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1),
});

export const skillReadLocalInputSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1),
});

export const skillLocalFilesSchema = z.object({
  dir: z.string(),
  files: z.array(
    z.object({
      relPath: z.string(),
      content: z.string(),
      base64: z.literal(true).optional(),
    }),
  ),
});

export const skillPublishInputSchema = z.object({
  agentId: z.string().min(1),
  sourceId: z.string().min(1),
  name: z.string().min(1),
  title: z.string().optional(),
  body: z.string().optional(),
});

export const skillCreateLocalInputSchema = z
  .object({
    agentId: z.string().min(1),
    skills: z
      .array(
        z.object({
          name: z.string().min(1).max(128),
          content: z.string().max(2 * 1024 * 1024),
        }),
      )
      .min(1)
      .max(50),
  })
  .refine(
    (v) =>
      v.skills.reduce((n, s) => n + s.content.length, 0) <= 5 * 1024 * 1024,
    "batch exceeds 5 MB",
  );
