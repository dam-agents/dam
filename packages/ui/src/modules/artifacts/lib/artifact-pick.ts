import {
  artifactInternalLink,
  type ArtifactPickedElement,
  type ArtifactPickMessage,
  artifactPickMessageSchema,
  type LibraryArtifact,
} from "api-server-api";

export function readArtifactPick(
  event: Pick<MessageEvent, "source" | "data">,
  pageWindow: MessageEventSource | null | undefined,
): ArtifactPickMessage | null {
  if (!pageWindow || event.source !== pageWindow) return null;
  const parsed = artifactPickMessageSchema.safeParse(event.data);
  return parsed.success ? parsed.data : null;
}

function fenceFor(body: string): string {
  let fence = "```";
  while (body.includes(fence)) fence += "`";
  return fence;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The text a pick leaves in the chat composer. It
 * names the artifact by the reference its Agent's artifact tools take, plus
 * the version the user looked at, then each picked element as its selector and
 * a markup snippet. The Agent uses the snippet to find the spot in the source.
 */
export function artifactPickQuote(
  artifact: Pick<LibraryArtifact, "id" | "title">,
  version: number,
  elements: ArtifactPickedElement[],
): string {
  const body = elements
    .map((e) => `<!-- ${e.selector} -->\n${e.snippet}`)
    .join("\n");
  const fence = fenceFor(body);
  const noun = elements.length === 1 ? "element" : "elements";
  return `${artifact.title} (${artifactInternalLink(artifact.id)}, version ${version}), selected ${noun}:\n${fence}html\n${body}\n${fence}\n`;
}
