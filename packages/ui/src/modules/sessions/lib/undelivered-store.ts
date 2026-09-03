import {
  type PlatformUndeliveredPrompt,
  platformUndeliveredPromptSchema,
  type PromptBlock,
  UNDELIVERED_INLINE_IMAGE_BYTES_CAP,
} from "api-server-api";
import { z } from "zod";

import type { Attachment } from "../../../types.js";

export const UNDELIVERED_STORAGE_PREFIX = "platform-undelivered:";

const RECORDS_CAP = 32;

const persistedUndeliveredSchema = z.object({
  version: z.literal(2),
  sends: z.array(platformUndeliveredPromptSchema),
});

export function undeliveredRecordOf(input: {
  id: string;
  text: string;
  attachments?: Attachment[];
  reason: string;
  recordedAt: string;
}): PlatformUndeliveredPrompt {
  const blocks: PromptBlock[] = [];
  const droppedAttachments: string[] = [];
  let inlineBytes = 0;
  let images = 0;
  for (const a of input.attachments ?? []) {
    if (a.kind !== "image") {
      droppedAttachments.push(a.name);
      continue;
    }
    images += 1;
    if (inlineBytes + a.data.length > UNDELIVERED_INLINE_IMAGE_BYTES_CAP) {
      droppedAttachments.push(`pasted image ${String(images)}`);
      continue;
    }
    inlineBytes += a.data.length;
    blocks.push({ type: "image", data: a.data, mimeType: a.mimeType });
  }
  if (input.text) blocks.push({ type: "text", text: input.text });
  return {
    id: input.id,
    recordedAt: input.recordedAt,
    blocks,
    droppedAttachments,
    reason: input.reason,
  };
}

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
): PlatformUndeliveredPrompt[] {
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
  sends: PlatformUndeliveredPrompt[],
  store: UndeliveredStore,
): void {
  let kept = sends.slice(-RECORDS_CAP);
  while (kept.length > 0) {
    try {
      store.setItem(
        storageKey(key),
        JSON.stringify({ version: 2, sends: kept } satisfies z.infer<
          typeof persistedUndeliveredSchema
        >),
      );
      return;
    } catch {
      kept = kept.slice(1);
    }
  }
  store.removeItem(storageKey(key));
}

export function rememberUndelivered(
  key: string,
  send: PlatformUndeliveredPrompt,
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
