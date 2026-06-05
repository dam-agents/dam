import { z } from "zod";

export const skillInstallInputSchema = z.object({
  sourceUrl: z.string().min(1),
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

// No skillPaths: the agent-runtime resolves them from its manifest.
export const skillPublishInputSchema = z.object({
  name: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
});

export const skillReadLocalInputSchema = z.object({
  name: z.string().min(1),
});
