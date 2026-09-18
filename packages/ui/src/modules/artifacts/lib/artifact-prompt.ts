import { artifactPromptSchema, type LibraryArtifact } from "api-server-api";

export function canSendArtifactPrompt(
  artifact: LibraryArtifact | null | undefined,
  enabled: boolean,
  agentId: string | null,
  version: number | undefined,
): boolean {
  return (
    enabled &&
    artifact?.interactive === true &&
    artifact.kind === "html" &&
    artifact.visibility === "private" &&
    agentId !== null &&
    artifact.agentId === agentId &&
    artifact.version === version
  );
}

export function readArtifactPrompt(
  event: Pick<MessageEvent, "source" | "data">,
  pageWindow: MessageEventSource | null | undefined,
): string | null {
  if (!pageWindow || event.source !== pageWindow) return null;
  const parsed = artifactPromptSchema.safeParse(event.data);
  return parsed.success ? parsed.data.prompt : null;
}
