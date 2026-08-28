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
  bound: boolean;
  brief: string | null;
  source: string | null;
}

function askedBy(trigger: ArtifactRequestTrigger): string {
  return trigger === "user"
    ? "A person is looking at the page and waiting for this answer."
    : "The page asked for this on its own, with nobody clicking. Keep the work small.";
}

function answerDirective(requestId: string, bound: boolean): string {
  const waiting = bound
    ? "Your reply in this conversation is not the answer: the page waits for that call."
    : "Finishing your turn is not the answer: the page waits for that call.";
  return (
    `Answer with \`answer_artifact_request\`, request_id "${requestId}". ` +
    `${waiting} Call it even if only to say you could not.`
  );
}

function briefSection(brief: string, bound: boolean): string {
  const why = bound
    ? "The standing rules you left on this page when you published it. Later asks do not repeat them:"
    : "You left this brief on the page when you published it, for this exact moment. This session " +
      "cannot see the conversation the page was written in, so the brief is the only thing you told " +
      "yourself about the job the page is doing. Follow it:";
  return [why, brief].join("\n\n");
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
    `Your interactive page "${input.title}" (artifact ${input.artifactId}) is asking you something.`,
    ...(input.brief !== null ? [briefSection(input.brief, input.bound)] : []),
    [
      `Request #${String(input.seq)}: ${input.action}`,
      JSON.stringify(input.payload),
    ].join("\n"),
    ...(input.bound ? [] : [askedBy(input.trigger)]),
    answerDirective(input.requestId, input.bound),
  ];
  if (input.source !== null) parts.push(sourceSection(input.source));
  return parts.join("\n\n");
}
