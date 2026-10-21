import type { Message } from "../../../types.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Claude Code writes its own copy of a model
 * call's error as reply text and then fails the turn with that same text, so
 * a reply can hold nothing but the error. Such a reply is the failure itself,
 * not an interrupted answer: the chat shows the error card in its place.
 */
export function repliesOnlyWithError(
  message: Message,
  errorText: string,
): boolean {
  const content = message.parts.filter((p) => p.kind !== "verdict");
  if (content.length === 0) return false;
  let said = "";
  for (const part of content) {
    if (part.kind !== "text") return false;
    said += part.text;
  }
  const trimmed = said.trim();
  const error = errorText.trim();
  if (trimmed === "" || !error.endsWith(trimmed)) return false;
  const lead = error.slice(0, error.length - trimmed.length).trim();
  return lead === "" || /^internal error:$/i.test(lead);
}
