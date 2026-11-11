export type EditSilence = "decline" | "carry-on";

const SILENCE: Record<EditSilence, string> = {
  decline: "If the change needs no answer, call no_reply_needed.",
  "carry-on": "If the change needs nothing from you, do not answer it.",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: What an Agent is told about a Slack message
 * someone edited. A person's edit to a message the Agent was sent reaches it
 * as that message again, marked as the text that replaces the earlier one;
 * the earlier text is not repeated, because the Session already holds it. The
 * mark says what to do about work done from the earlier text, and how to stay
 * silent on the surface the turn runs on. Any other edit starts no turn: the
 * Agent's next turn lists the messages as they read now, as something to work
 * from and not a request.
 */
export function editedMessageText(
  ts: string,
  text: string,
  silence: EditSilence,
): string {
  return (
    `[edited: the sender changed their message with ts ${ts}, and this text ` +
    "replaces what it said before. If you already acted on the earlier " +
    "text, correct what you can and tell them what you cannot undo. " +
    `${SILENCE[silence]}] ${text}`
  );
}

export const CHANGED_MESSAGES_NOTE =
  "These messages were edited after you were shown them. Each line is the " +
  "message as it reads now and replaces what you saw before. Nobody is " +
  "asking you about the edit: work from the new text from here on, and act " +
  "on it only where something you already did depends on what changed.";

export function changedMessagesBlock(lines: readonly string[]): string {
  return [
    "<changed-messages>",
    CHANGED_MESSAGES_NOTE,
    ...lines,
    "</changed-messages>",
  ].join("\n");
}
