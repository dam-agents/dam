import type { PlatformVerdict, PlatformVerdictKind } from "api-server-api";

import type { Message, VerdictPart } from "../../../types.js";
import { withAttachmentNames } from "../../files/lib/upload-path.js";

export function verdictKindLabel(kind: PlatformVerdictKind): string {
  switch (kind) {
    case "allow_once":
      return "Allowed once";
    case "allow_always":
      return "Always allowed";
    case "reject_once":
      return "Denied";
    case "reject_always":
      return "Always denied";
  }
}

function toolTitleIn(message: Message, toolCallId: string): string | null {
  for (const part of message.parts)
    if (part.kind === "tool" && part.toolCallId === toolCallId)
      return withAttachmentNames(part.title);
  return null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the verdict line under each tool call a person
 * answered, drawn from the verdicts the runtime keeps rather than only from
 * the answer this tab gave, so the line, and who gave it, survive a reload
 * and a restart. A line this tab already drew for the same tool call takes the
 * recorded answerer instead of being drawn twice.
 */
export function withVerdicts(
  messages: Message[],
  verdicts: readonly PlatformVerdict[],
): Message[] {
  if (verdicts.length === 0) return messages;
  const byToolCall = new Map(verdicts.map((v) => [v.toolCallId, v]));
  const drawn = new Set<string>();
  let next = messages.map((message) => {
    let changed = false;
    const parts = message.parts.map((part) => {
      if (part.kind !== "verdict" || part.toolCallId === undefined) return part;
      const verdict = byToolCall.get(part.toolCallId);
      if (verdict === undefined) return part;
      drawn.add(part.toolCallId);
      changed = true;
      return { ...part, by: verdict.by };
    });
    return changed ? { ...message, parts } : message;
  });
  for (const verdict of verdicts) {
    if (drawn.has(verdict.toolCallId)) continue;
    const index = next.findIndex(
      (m) =>
        m.role === "assistant" && toolTitleIn(m, verdict.toolCallId) !== null,
    );
    if (index === -1) continue;
    const owner = next[index]!;
    const line: VerdictPart = {
      kind: "verdict",
      toolCallId: verdict.toolCallId,
      label: verdictKindLabel(verdict.kind),
      subject: toolTitleIn(owner, verdict.toolCallId) ?? "",
      allowed: verdict.kind.startsWith("allow"),
      by: verdict.by,
    };
    next = next.map((m, i) =>
      i === index ? { ...m, parts: [...m.parts, line] } : m,
    );
  }
  return next;
}
