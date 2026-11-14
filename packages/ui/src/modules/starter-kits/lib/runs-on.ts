import type { StarterKitView } from "api-server-api";

import { HARNESS_ICONS } from "@/components/harness-icons";

import { prettyModelLabel } from "../../sessions/lib/model-families.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one line that says what the Agent a kit
 * creates will run on, because a kit may pin a harness or a model of its own
 * instead of following the user's default. The kit's own declaration is the
 * truth: this dialog sends no template, so the new Agent takes its image's
 * harness, else the first harness the kit lists, and the model the kit names
 * when it names one (`defaultModel` reaches the Agent, so it wins over the
 * harness name). A kit that pins neither runs on the platform default, which
 * the kit data does not say, so it gets no line.
 */
export function kitRunsOn(
  kit: Pick<StarterKitView, "image" | "harnesses" | "defaultModel">,
): string | null {
  const harness = kit.image?.harness ?? kit.harnesses?.[0];
  const runsOn = kit.defaultModel
    ? (prettyModelLabel(kit.defaultModel) ?? kit.defaultModel)
    : harness
      ? HARNESS_ICONS[harness].label
      : null;
  return runsOn ? `Runs on ${runsOn}` : null;
}
