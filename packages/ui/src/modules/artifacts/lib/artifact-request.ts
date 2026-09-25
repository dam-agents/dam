import {
  type ArtifactCallAgentApiInput,
  artifactRequestEnvelopeSchema,
  artifactRequestMessageSchema,
} from "api-server-api";

export type ArtifactApiRequest = Omit<ArtifactCallAgentApiInput, "artifactId">;

export interface ArtifactRequestRead {
  id: string;
  request: ArtifactApiRequest | null;
}

export function readArtifactRequest(
  event: Pick<MessageEvent, "source" | "data">,
  pageWindow: MessageEventSource | null | undefined,
): ArtifactRequestRead | null {
  if (!pageWindow || event.source !== pageWindow) return null;
  const envelope = artifactRequestEnvelopeSchema.safeParse(event.data);
  if (!envelope.success) return null;
  const parsed = artifactRequestMessageSchema.safeParse(event.data);
  if (!parsed.success) return { id: envelope.data.id, request: null };
  const { method, path, body, contentType } = parsed.data;
  return { id: envelope.data.id, request: { method, path, body, contentType } };
}
