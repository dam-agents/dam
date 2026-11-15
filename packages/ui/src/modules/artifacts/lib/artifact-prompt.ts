import { type ArtifactPrompt, artifactPromptSchema } from "api-server-api";

export function readArtifactPrompt(
  event: Pick<MessageEvent, "source" | "data">,
  pageWindow: MessageEventSource | null | undefined,
): Pick<ArtifactPrompt, "prompt" | "newSession" | "conversation"> | null {
  if (!pageWindow || event.source !== pageWindow) return null;
  const parsed = artifactPromptSchema.safeParse(event.data);
  if (!parsed.success) return null;
  const { prompt, newSession, conversation } = parsed.data;
  return {
    prompt,
    ...(newSession && { newSession }),
    ...(conversation !== undefined && { conversation }),
  };
}
