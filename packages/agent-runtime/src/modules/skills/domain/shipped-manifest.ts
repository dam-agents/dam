import { z } from "zod";
import { err, ok, type Result } from "../../../core/result.js";

export const shippedSkillManifestSchema = z.object({
  manifestVersion: z.literal(1),
  skills: z.record(z.string(), z.array(z.string())),
});

export type ShippedSkillManifest = z.infer<typeof shippedSkillManifestSchema>;

export interface InvalidShippedSkillManifest {
  kind: "InvalidShippedSkillManifest";
  reason: string;
}

export function parseShippedSkillManifest(
  raw: unknown,
): Result<ShippedSkillManifest, InvalidShippedSkillManifest> {
  const parsed = shippedSkillManifestSchema.safeParse(raw);
  if (parsed.success) return ok(parsed.data);
  return err({
    kind: "InvalidShippedSkillManifest",
    reason: parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; "),
  });
}
