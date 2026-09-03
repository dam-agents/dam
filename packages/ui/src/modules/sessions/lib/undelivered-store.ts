import { z } from "zod";

export const UNDELIVERED_STORAGE_PREFIX = "platform-undelivered:";

const persistedUndeliveredSchema = z.object({
  version: z.literal(1),
  sends: z.array(
    z.object({
      id: z.string().min(1),
      recordedAt: z.string(),
      text: z.string(),
      droppedAttachments: z.array(z.string()).default([]),
      reason: z.string(),
    }),
  ),
});

export type UndeliveredSend = z.infer<
  typeof persistedUndeliveredSchema
>["sends"][number];

export interface UndeliveredStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const browserStore: UndeliveredStore = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

function storageKey(key: string): string {
  return `${UNDELIVERED_STORAGE_PREFIX}${key}`;
}

export function readUndelivered(
  key: string,
  store: UndeliveredStore = browserStore,
): UndeliveredSend[] {
  const raw = store.getItem(storageKey(key));
  if (raw === null) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    store.removeItem(storageKey(key));
    return [];
  }
  const parsed = persistedUndeliveredSchema.safeParse(json);
  if (!parsed.success) {
    store.removeItem(storageKey(key));
    return [];
  }
  return parsed.data.sends;
}

function writeUndelivered(
  key: string,
  sends: UndeliveredSend[],
  store: UndeliveredStore,
): void {
  if (sends.length === 0) {
    store.removeItem(storageKey(key));
    return;
  }
  try {
    store.setItem(
      storageKey(key),
      JSON.stringify({ version: 1, sends } satisfies z.infer<
        typeof persistedUndeliveredSchema
      >),
    );
  } catch {
    store.removeItem(storageKey(key));
  }
}

export function rememberUndelivered(
  key: string,
  send: UndeliveredSend,
  store: UndeliveredStore = browserStore,
): void {
  const kept = readUndelivered(key, store).filter((s) => s.id !== send.id);
  writeUndelivered(key, [...kept, send], store);
}

export function forgetUndelivered(
  key: string,
  id: string,
  store: UndeliveredStore = browserStore,
): void {
  const kept = readUndelivered(key, store).filter((s) => s.id !== id);
  writeUndelivered(key, kept, store);
}

export function clearUndelivered(
  key: string,
  store: UndeliveredStore = browserStore,
): void {
  store.removeItem(storageKey(key));
}
