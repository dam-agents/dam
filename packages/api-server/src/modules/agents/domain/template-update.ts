import type { TemplateUpdate } from "api-server-api";

export function templateImageUpdate(
  agentImage: string | undefined,
  templateImage: string,
): TemplateUpdate | undefined {
  if (!agentImage || agentImage === templateImage) return undefined;
  return { fromImage: agentImage, toImage: templateImage };
}
