import type { TemplateUpdate } from "api-server-api";

/** The pending template upgrade (#1077), or undefined when the agent is
 *  current. The image ref is the template's version identity — templates
 *  ship a fully-resolved `repo:tag` (tag defaults to the chart appVersion),
 *  so any difference from the create-time capture means the template moved. */
export function templateImageUpdate(
  agentImage: string | undefined,
  templateImage: string,
): TemplateUpdate | undefined {
  if (!agentImage || agentImage === templateImage) return undefined;
  return { fromImage: agentImage, toImage: templateImage };
}
