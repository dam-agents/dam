export const ASK_ERROR_MAX = 200;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the part of a raw failure a person would read out
 * loud: its first line, with control characters and runs of whitespace folded
 * into single spaces and the closing punctuation dropped, so it ends a sentence
 * of the message that carries it. It is cut at `ASK_ERROR_MAX` with an ellipsis,
 * because a stack trace or a runtime's multi-line message must still reach the
 * assistant's composer as one short message the person can send.
 */
export function askErrorLine(text: string): string {
  const [first = ""] = text.split(/\r\n|[\r\n]/);
  const line = first
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/, "");
  if (line.length <= ASK_ERROR_MAX) return line;
  return `${line.slice(0, ASK_ERROR_MAX - 1).trimEnd()}…`;
}

const ASK = "Please explain what happened and what I can do.";

export function askAboutTurn({
  agentName,
  sessionId,
  at,
  error,
}: {
  agentName: string;
  sessionId: string;
  at: string;
  error: string;
}): string {
  return `${agentName}'s turn in session ${sessionId} ended in an error at ${at}: ${askErrorLine(error)}. ${ASK}`;
}

export function askAboutCrash({
  agentName,
  at,
  notice,
}: {
  agentName: string;
  at: string;
  notice: string;
}): string {
  return `${agentName} crashed at ${at}: ${askErrorLine(notice)}. ${ASK}`;
}

export function askAboutUnavailable({
  agentName,
  at,
  description,
}: {
  agentName: string;
  at: string;
  description: string;
}): string {
  return `${agentName} is unavailable at ${at}: ${askErrorLine(description)}. ${ASK}`;
}

export function askAboutSchedule({
  agentName,
  scheduleName,
  at,
  result,
}: {
  agentName: string;
  scheduleName: string;
  at: string;
  result: string;
}): string {
  return `The schedule "${scheduleName}" on ${agentName} last fired at ${at} with the result: ${askErrorLine(result)}. ${ASK}`;
}

export function canAskAssistant({
  assistantOn,
  assistantKnown,
  assistantId,
  agentId,
  isOwner,
}: {
  assistantOn: boolean;
  assistantKnown: boolean;
  assistantId: string | null | undefined;
  agentId: string | null | undefined;
  isOwner: boolean;
}): boolean {
  return (
    assistantKnown &&
    assistantOn &&
    assistantId !== null &&
    assistantId !== undefined &&
    agentId !== null &&
    agentId !== undefined &&
    agentId !== assistantId &&
    isOwner
  );
}
