import type { Attachment } from "../../../types.js";

export interface SessionDraft {
  text: string;
  attachments: Attachment[];
}

const NO_ATTACHMENTS: Attachment[] = [];
Object.freeze(NO_ATTACHMENTS);

export const EMPTY_DRAFT: SessionDraft = Object.freeze({
  text: "",
  attachments: NO_ATTACHMENTS,
});

const BLANK_CHAT = "~new";

export function draftKey(agentId: string, sessionId: string | null): string {
  return `${agentId}:${sessionId ?? BLANK_CHAT}`;
}

export function draftHasContent(draft: SessionDraft): boolean {
  return draft.text.trim().length > 0 || draft.attachments.length > 0;
}
