import type { StarterKitView } from "api-server-api";

import { HARNESS_ICONS } from "@/components/harness-icons";

import { prettyModelLabel } from "../../sessions/lib/model-families.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the line that says what the Agent a kit creates
 * will run on, because a kit may pin a harness or a model of its own instead
 * of following the user's default. The kit's own declaration is the truth:
 * this dialog sends no template, so the new Agent takes its image's harness,
 * else the first harness the kit lists. The model the kit names becomes the
 * Agent's chat default only when a granted provider lists it. A kit that pins
 * neither runs on the platform default, which the kit data does not say, so
 * it gets no line.
 */
export function kitRunsOn(
  kit: Pick<StarterKitView, "image" | "harnesses" | "defaultModel">,
): string | null {
  const harness = kit.image?.harness ?? kit.harnesses?.[0];
  const parts: string[] = [];
  if (harness) parts.push(`Harness: ${HARNESS_ICONS[harness].label}`);
  if (kit.defaultModel)
    parts.push(
      `Model: ${prettyModelLabel(kit.defaultModel) ?? kit.defaultModel}`,
    );
  return parts.length > 0 ? parts.join(" · ") : null;
}
