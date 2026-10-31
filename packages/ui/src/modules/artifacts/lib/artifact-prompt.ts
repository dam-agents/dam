import { type ArtifactPrompt, artifactPromptSchema } from "api-server-api";

export function readArtifactPrompt(
  event: Pick<MessageEvent, "source" | "data">,
  pageWindow: MessageEventSource | null | undefined,
): Pick<ArtifactPrompt, "prompt" | "newSession"> | null {
  if (!pageWindow || event.source !== pageWindow) return null;
  const parsed = artifactPromptSchema.safeParse(event.data);
  if (!parsed.success) return null;
  const { prompt, newSession } = parsed.data;
  return newSession ? { prompt, newSession } : { prompt };
}
