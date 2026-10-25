import type { Sender } from "agent-runtime-api";
import type { PlatformSenderEntry } from "api-server-api";

import type { Message } from "../../../types.js";

const MATCH_BEFORE_MS = 60_000;
const MATCH_AFTER_MS = 5_000;

function promptIdOf(message: Message): string {
  return message.id.replace(/:\d+$/, "");
}

function nearestByTime(
  at: string | undefined,
  entries: readonly { ms: number; sender: Sender }[],
): Sender | undefined {
  if (at === undefined) return undefined;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return undefined;
  let best: { gap: number; sender: Sender } | undefined;
  for (const entry of entries) {
    const gap = ms - entry.ms;
    if (gap > MATCH_BEFORE_MS || gap < -MATCH_AFTER_MS) continue;
    if (best === undefined || Math.abs(gap) < best.gap)
      best = { gap: Math.abs(gap), sender: entry.sender };
  }
  return best?.sender;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Sender of each person-sent message. A message
 * the runtime echoed or this tab sent carries its prompt id, which the
 * Sender list names. A log rebuilt from the harness's own history (after a
 * restart, a hibernation or a rewind that cuts in place) gives messages new
 * ids, so such a message takes the Sender recorded nearest its time, as run
 * dividers do with run starts. A message the platform made, a notice, has no
 * Sender.
 */
export function messageSenders(
  messages: readonly Message[],
  entries: readonly PlatformSenderEntry[],
): Map<number, Sender> {
  const senders = new Map<number, Sender>();
  if (entries.length === 0) return senders;
  const byPrompt = new Map<string, Sender>();
  const timed: { ms: number; sender: Sender }[] = [];
  for (const entry of entries) {
    if (entry.promptId !== undefined)
      byPrompt.set(entry.promptId, entry.sender);
    const ms = Date.parse(entry.at);
    if (Number.isFinite(ms)) timed.push({ ms, sender: entry.sender });
  }
  messages.forEach((message, index) => {
    if (message.role !== "user" || message.notice) return;
    const sender =
      byPrompt.get(message.id) ??
      byPrompt.get(promptIdOf(message)) ??
      nearestByTime(message.at, timed);
    if (sender !== undefined) senders.set(index, sender);
  });
  return senders;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: where the chat names a Sender. The first message
 * a person sent gets a divider only when that person is not the viewer, and
 * every change of Sender after it gets one. A message with no Sender neither
 * gets one nor changes who sent last, so a session only the viewer wrote to
 * shows none.
 */
export function senderMarks(
  messages: readonly Message[],
  entries: readonly PlatformSenderEntry[],
  viewerSub: string | undefined,
): Map<number, Sender> {
  const marks = new Map<number, Sender>();
  let last: Sender | undefined;
  for (const [index, sender] of messageSenders(messages, entries)) {
    if (sender.sub === last?.sub) continue;
    if (last !== undefined || sender.sub !== viewerSub)
      marks.set(index, sender);
    last = sender;
  }
  return marks;
}
