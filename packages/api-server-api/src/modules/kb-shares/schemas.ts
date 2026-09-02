import { z } from "zod";

export const KB_SHARE_STRING_PREFIX = "kbshare_";

export const kbShareRootSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^(?!\.)[A-Za-z0-9._-]+$/,
    "a share root is a single top-level directory name and cannot start with a dot",
  );

export const kbShareAgentInputSchema = z.object({
  agentId: z.string().min(1),
});

export const kbShareCreateInputSchema = z.object({
  agentId: z.string().min(1),
  roots: z.array(kbShareRootSchema).min(1).max(20).optional(),
});

export const kbShareRefreshInputSchema = kbShareCreateInputSchema;

export const kbSharePublicNameSchema = z.string().trim().min(1).max(100);

export const kbShareSetNameInputSchema = z.object({
  agentId: z.string().min(1),
  name: kbSharePublicNameSchema,
});

export const kbShareResolveInputSchema = z.object({
  shareString: z.string().min(1).max(200),
});

export const kbShareStringRegex =
  /^kbshare_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

export function parseKbShareString(
  value: string,
): { shareId: string; secret: string } | null {
  const match = kbShareStringRegex.exec(value.trim());
  return match ? { shareId: match[1]!, secret: match[2]! } : null;
}

export const kbSharePublishStateSchema = z.enum([
  "idle",
  "publishing",
  "failed",
]);
