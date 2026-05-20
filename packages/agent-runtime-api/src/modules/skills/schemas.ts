import { z } from "zod";

export const skillInstallInputSchema = z.object({
  source: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  skillPaths: z.array(z.string().min(1)).min(1),
});

export const skillUninstallInputSchema = z.object({
  name: z.string().min(1),
  skillPaths: z.array(z.string().min(1)).min(1),
});

export const skillScanInputSchema = z.object({
  source: z.string().min(1),
});

export const skillPublishInputSchema = z.object({
  name: z.string().min(1),
  skillPaths: z.array(z.string().min(1)).min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
});

export const skillListLocalInputSchema = z.object({
  skillPaths: z.array(z.string().min(1)).min(1),
});

export const skillReadLocalInputSchema = z.object({
  name: z.string().min(1),
  skillPaths: z.array(z.string().min(1)).min(1),
});
