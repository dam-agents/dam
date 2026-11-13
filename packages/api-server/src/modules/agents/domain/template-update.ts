import type { TemplateUpdate } from "api-server-api";
import { z } from "zod";

// UNIT_BOUNDARY_DESCRIPTION: when an Agent first met an image its Template offers and it does not run, kept so the forced move counts from the image's arrival and not from anything that resets, such as the Agent's creation or its last restart. `image` is the target it was recorded for: a stamp for an image the Agent now runs counts for nothing, and one for a target the Template left and later named again counts from the first meeting.
export const imageOutdatedSchema = z.object({
  image: z.string().min(1),
  at: z.string().min(1),
});

export type ImageOutdated = z.infer<typeof imageOutdatedSchema>;

export function outdatedSince(
  outdated: ImageOutdated | undefined,
  templateImage: string,
): Date | undefined {
  if (!outdated || outdated.image !== templateImage) return undefined;
  const at = new Date(outdated.at);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

export function templateImageUpdate(
  agentImage: string | undefined,
  templateImage: string,
  refusedImage?: string,
): TemplateUpdate | undefined {
  if (!agentImage || agentImage === templateImage) return undefined;
  return {
    fromImage: agentImage,
    toImage: templateImage,
    ...(refusedImage === templateImage ? { startFailed: true } : {}),
  };
}
