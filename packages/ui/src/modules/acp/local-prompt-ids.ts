/**
 * Tab-local memory of promptIds the UI rendered as optimistic bubbles. The
 * wrapper synthesizes a `user_message_chunk` for every forwarded prompt and
 * fans it out to all engaged channels — including the originating tab,
 * because the durable-prompt path makes the api-server's one-shot WS the
 * "originator" instead of the UI's WS. Without this filter, the UI would
 * see its own optimistic bubble plus the wrapper's echo and merge them
 * (mergeParts concatenates text), turning "hi" into "hihi".
 *
 * The check is tab-local on purpose: other tabs viewing the same session
 * have no optimistic bubble, so they should render the wrapper's echo as
 * a fresh user bubble. Cold-replay after a reload is the same: the local
 * set is empty, so all echoes go through.
 *
 * Memory is unbounded but each entry is a UUID string (~36 bytes); a
 * worst-case 10k-prompt session is ~360 KB. Clearing on session change
 * keeps it tighter.
 */
const localPromptIds = new Set<string>();

export function addLocalPromptId(promptId: string): void {
  localPromptIds.add(promptId);
}

export function hasLocalPromptId(promptId: string): boolean {
  return localPromptIds.has(promptId);
}

export function clearLocalPromptIds(): void {
  localPromptIds.clear();
}
