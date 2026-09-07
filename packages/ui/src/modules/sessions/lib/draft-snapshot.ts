import { z } from "zod";

import type { SessionDraft } from "./draft-key.js";
import {
  browserStorage,
  type KeyValueStore,
  removeAllWithPrefix,
  safeGetItem,
  safeKeys,
  safeRemoveItem,
} from "./safe-storage.js";

export const DRAFT_STORAGE_PREFIX = "platform-draft:";

const DRAFT_OWNER_KEY = "platform-draft-owner";

const WRITE_BATCH_MS = 300;

const persistedDraftSchema = z.object({
  version: z.literal(1),
  text: z.string(),
  attachmentNames: z.array(z.string()),
});

type PersistedDraft = z.infer<typeof persistedDraftSchema>;

function parseDraftEntry(raw: string): SessionDraft | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = persistedDraftSchema.safeParse(json);
  if (!parsed.success) return null;
  const { text, attachmentNames: names } = parsed.data;
  if (text.length === 0 && names.length === 0) return null;
  return {
    text,
    attachments: [],
    ...(names.length > 0 ? { droppedAttachmentNames: names } : {}),
  };
}

function attachmentNames(draft: SessionDraft): string[] {
  let images = 0;
  const staged = draft.attachments.map((a) =>
    a.kind === "file" ? a.name : `pasted image ${++images}`,
  );
  return [...staged, ...(draft.droppedAttachmentNames ?? [])];
}

export function loadDraftSnapshot(
  store: KeyValueStore = browserStorage,
): Record<string, SessionDraft> {
  const drafts: Record<string, SessionDraft> = {};
  for (const storageKey of safeKeys(store)) {
    if (!storageKey.startsWith(DRAFT_STORAGE_PREFIX)) continue;
    const raw = safeGetItem(store, storageKey);
    if (raw === null) continue;
    const draft = parseDraftEntry(raw);
    if (draft === null) {
      console.warn(`[drafts] discarding unreadable ${storageKey}`);
      safeRemoveItem(store, storageKey);
      continue;
    }
    drafts[storageKey.slice(DRAFT_STORAGE_PREFIX.length)] = draft;
  }
  return drafts;
}

function writeDraftEntry(
  key: string,
  draft: SessionDraft | null,
  store: KeyValueStore,
): void {
  const storageKey = `${DRAFT_STORAGE_PREFIX}${key}`;
  const names = draft === null ? [] : attachmentNames(draft);
  const blank =
    draft === null || (draft.text.trim().length === 0 && names.length === 0);
  try {
    if (blank) {
      store.removeItem(storageKey);
      return;
    }
    store.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        text: draft.text,
        attachmentNames: names,
      } satisfies PersistedDraft),
    );
  } catch (err) {
    console.warn(`[drafts] could not persist ${storageKey}:`, err);
  }
}

export interface DraftWriter {
  write(key: string, draft: SessionDraft | null): void;
  flush(): void;
  clearAll(): void;
}

export function createDraftWriter(
  store: KeyValueStore = browserStorage,
  batchMs: number = WRITE_BATCH_MS,
): DraftWriter {
  const queued = new Map<string, SessionDraft>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const discardQueue = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    queued.clear();
  };

  const flush = () => {
    const pending = [...queued];
    discardQueue();
    for (const [key, draft] of pending) writeDraftEntry(key, draft, store);
  };

  return {
    write(key, draft) {
      if (draft === null) {
        queued.delete(key);
        writeDraftEntry(key, null, store);
        return;
      }
      queued.set(key, draft);
      if (timer === null) timer = setTimeout(flush, batchMs);
    },
    flush,
    clearAll() {
      discardQueue();
      removeAllWithPrefix(store, DRAFT_STORAGE_PREFIX);
    },
  };
}

export const draftWriter = createDraftWriter();

export function claimDraftsFor(
  ownerId: string,
  store: KeyValueStore = browserStorage,
): boolean {
  let previous: string | null = null;
  try {
    previous = store.getItem(DRAFT_OWNER_KEY);
  } catch {
    return false;
  }
  if (previous === ownerId) return false;
  const foreign = previous !== null;
  if (foreign) removeAllWithPrefix(store, DRAFT_STORAGE_PREFIX);
  try {
    store.setItem(DRAFT_OWNER_KEY, ownerId);
  } catch {}
  return foreign;
}

export function onForeignDraftChange(
  apply: (key: string, draft: SessionDraft | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: StorageEvent) => {
    if (!e.key?.startsWith(DRAFT_STORAGE_PREFIX)) return;
    const key = e.key.slice(DRAFT_STORAGE_PREFIX.length);
    if (e.newValue === null) {
      apply(key, null);
      return;
    }
    const draft = parseDraftEntry(e.newValue);
    if (draft !== null) apply(key, draft);
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

export function flushDraftsOnHide(
  writer: DraftWriter = draftWriter,
): () => void {
  if (typeof window === "undefined") return () => {};
  const flush = () => writer.flush();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", flush);
  return () => {
    window.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", flush);
  };
}
