import { artifactPromptSchema } from "api-server-api";

export function readArtifactPrompt(
  event: Pick<MessageEvent, "source" | "data">,
  pageWindow: MessageEventSource | null | undefined,
): string | null {
  if (!pageWindow || event.source !== pageWindow) return null;
  const parsed = artifactPromptSchema.safeParse(event.data);
  return parsed.success ? parsed.data.prompt : null;
}
