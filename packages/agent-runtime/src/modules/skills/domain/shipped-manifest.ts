import { z } from "zod";

export const shippedSkillManifestSchema = z.object({
  manifestVersion: z.literal(1),
  skills: z.record(z.string(), z.array(z.string())),
});

export type ShippedSkillManifest = z.infer<typeof shippedSkillManifestSchema>;

export function parseShippedSkillManifest(
  raw: unknown,
): ShippedSkillManifest | undefined {
  const parsed = shippedSkillManifestSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
