import { z } from "zod";

import type { SessionDraft } from "./draft-key.js";

export const DRAFTS_STORAGE_KEY = "platform-drafts";

const persistedDraftSchema = z.object({
  text: z.string(),
  attachmentNames: z.array(z.string()),
});

const draftSnapshotSchema = z.object({
  version: z.literal(1),
  drafts: z.record(z.string(), persistedDraftSchema),
});

export type DraftSnapshot = z.infer<typeof draftSnapshotSchema>;

export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const localStore: DraftStore = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};

export function loadDraftSnapshot(
  store: DraftStore = localStore,
): Record<string, SessionDraft> {
  let raw: string | null = null;
  try {
    raw = store.getItem(DRAFTS_STORAGE_KEY);
  } catch {}
  if (!raw) return {};
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.warn("[drafts] discarding unreadable platform-drafts:", err);
    return {};
  }
  const parsed = draftSnapshotSchema.safeParse(json);
  if (!parsed.success) {
    console.warn(
      "[drafts] schema mismatch on platform-drafts, discarding:",
      parsed.error.issues,
    );
    return {};
  }
  const drafts: Record<string, SessionDraft> = {};
  for (const [key, row] of Object.entries(parsed.data.drafts)) {
    if (row.text.length === 0 && row.attachmentNames.length === 0) continue;
    drafts[key] = {
      text: row.text,
      attachments: [],
      ...(row.attachmentNames.length > 0
        ? { droppedAttachmentNames: row.attachmentNames }
        : {}),
    };
  }
  return drafts;
}

function attachmentNames(draft: SessionDraft): string[] {
  let images = 0;
  const staged = draft.attachments.map((a) =>
    a.kind === "file" ? a.name : `pasted image ${++images}`,
  );
  return [...staged, ...(draft.droppedAttachmentNames ?? [])];
}

export function saveDraftSnapshot(
  drafts: Record<string, SessionDraft>,
  store: DraftStore = localStore,
): void {
  const rows: DraftSnapshot["drafts"] = {};
  for (const [key, draft] of Object.entries(drafts)) {
    const names = attachmentNames(draft);
    if (draft.text.trim().length === 0 && names.length === 0) continue;
    rows[key] = { text: draft.text, attachmentNames: names };
  }
  try {
    store.setItem(
      DRAFTS_STORAGE_KEY,
      JSON.stringify({ version: 1, drafts: rows } satisfies DraftSnapshot),
    );
  } catch (err) {
    console.warn("[drafts] could not persist platform-drafts:", err);
  }
}

export function onForeignDraftChange(
  merge: (drafts: Record<string, SessionDraft>) => void,
): void {
  if (typeof window === "undefined") return;
  window.addEventListener("storage", (e) => {
    if (e.key !== DRAFTS_STORAGE_KEY || e.newValue === null) return;
    merge(loadDraftSnapshot({ getItem: () => e.newValue, setItem: () => {} }));
  });
}
