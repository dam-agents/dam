import type { ArtifactRequestTrigger } from "api-server-api";

export const ARTIFACT_REQUEST_SOURCE_MAX_BYTES = 128 * 1024;

export interface ArtifactRequestPromptInput {
  requestId: string;
  artifactId: string;
  title: string;
  seq: number;
  action: string;
  payload: Record<string, unknown>;
  trigger: ArtifactRequestTrigger;
  source: string | null;
}

function askedBy(trigger: ArtifactRequestTrigger): string {
  return trigger === "user"
    ? "A person is looking at the page and waiting for this answer."
    : "The page asked for this on its own, with nobody clicking. Keep the work small.";
}

function answerDirective(requestId: string): string {
  return (
    `Report the answer by calling the \`answer_artifact_request\` tool with request_id "${requestId}" ` +
    "and a `result` object. The page reads `result` with its own code, so shape it for the page, not for a human reader. " +
    "Finishing your turn is not an answer: the page waits until the tool call lands, and a request takes exactly one answer. " +
    "The page can ask again the moment this answer lands, so answer what was asked and stop — a page that asks in small steps beats one that makes the person wait for everything at once. " +
    "If you cannot do what was asked, still call the tool and say why inside `result`."
  );
}

function sourceSection(source: string): string {
  const bytes = new TextEncoder().encode(source).length;
  if (bytes > ARTIFACT_REQUEST_SOURCE_MAX_BYTES) {
    return (
      "This is the first request in this session. The page's source is too big to inline here — " +
      "call `get_artifact` to read it."
    );
  }
  return [
    "This is the first request in this session, so here is the page's current source. " +
      "Later requests in this session do not repeat it — call `get_artifact` to re-read it. " +
      "The page renders your `result` itself, so answering never needs a new version: " +
      "publish one with `update_artifact` only when the page's own code has to change.",
    "```html",
    source,
    "```",
  ].join("\n");
}

export function buildArtifactRequestPrompt(
  input: ArtifactRequestPromptInput,
): string {
  const parts = [
    `Your interactive page "${input.title}" (artifact ${input.artifactId}) is asking you to do something.`,
    [
      `Request #${input.seq}`,
      `action: ${input.action}`,
      `payload: ${JSON.stringify(input.payload)}`,
    ].join("\n"),
    askedBy(input.trigger),
    answerDirective(input.requestId),
  ];
  if (input.source !== null) parts.push(sourceSection(input.source));
  return parts.join("\n\n");
}
