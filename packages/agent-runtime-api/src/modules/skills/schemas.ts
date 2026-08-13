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

export const skillPublishInputSchema = z.object({
  name: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  path: z.string().optional(),
});

export const skillListLocalInputSchema = z.object({
  hashNames: z.array(z.string()).optional(),
});

export const skillReadLocalInputSchema = z.object({
  name: z.string().min(1),
});

export const skillReadPullRequestInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
});

export const skillReadSkillFileInputSchema = z.object({
  source: z.string().min(1),
  version: z.string().min(1),
  dir: z.string().min(1),
});

export const skillDeleteLocalInputSchema = z.object({
  name: z.string().min(1),
});

export const skillWriteLocalInputSchema = z.object({
  skills: z
    .array(
      z.object({
        name: z.string().min(1).max(128),
        content: z.string(),
      }),
    )
    .min(1)
    .max(50),
});
