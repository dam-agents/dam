import type { TemplateUpdate } from "api-server-api";

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
