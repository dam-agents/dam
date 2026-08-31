export interface ArtifactRequestPromptInput {
  requestId: string;
  artifactId: string;
  title: string;
  seq: number;
  action: string;
  payload: Record<string, unknown>;
}

// UNIT_BOUNDARY_DESCRIPTION: The prompt a request lands as, and it is short on purpose: the rules for answering are written on the `answer_artifact_request` tool, and the ask resumes the conversation the page belongs to, which already knows the page. So it carries only what the tool cannot know — which page asked, the action and payload, the request id — and the one line that a reply in the chat is not the answer. It never inlines the page source: even when the binding chat is not the chat that wrote the HTML, the artifact id is enough, and the agent calls `get_artifact`.
export function buildArtifactRequestPrompt(
  input: ArtifactRequestPromptInput,
): string {
  return [
    `Your interactive page "${input.title}" (artifact ${input.artifactId}) is asking you something.`,
    [
      `Request #${String(input.seq)}: ${input.action}`,
      JSON.stringify(input.payload),
    ].join("\n"),
    `Answer with \`answer_artifact_request\`, request_id "${input.requestId}". ` +
      "Your reply in this conversation is not the answer: the page waits for that call. " +
      "Call it even if only to say you could not.",
  ].join("\n\n");
}
