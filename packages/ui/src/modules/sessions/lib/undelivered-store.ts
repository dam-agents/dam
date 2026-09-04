import {
  capInlineImages,
  type PlatformUndeliveredPrompt,
  platformUndeliveredPromptSchema,
  type PromptBlock,
} from "api-server-api";
import { z } from "zod";

import type { Attachment } from "../../../types.js";
import {
  browserStorage,
  type KeyValueStore,
  removeAllWithPrefix,
  safeGetItem,
  safeRemoveItem,
} from "./safe-storage.js";

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
  blocks?: PromptBlock[];
  reason: string;
  recordedAt: string;
}): PlatformUndeliveredPrompt {
  const staged: PromptBlock[] = [];
  const droppedFiles: string[] = [];
  if (input.blocks !== undefined && input.blocks.length > 0) {
    staged.push(...input.blocks);
  } else {
    for (const a of input.attachments ?? []) {
      if (a.kind === "image")
        staged.push({ type: "image", data: a.data, mimeType: a.mimeType });
      else droppedFiles.push(a.name);
    }
    if (input.text) staged.push({ type: "text", text: input.text });
  }
  const capped = capInlineImages(staged);
  return {
    id: input.id,
    recordedAt: input.recordedAt,
    blocks: capped.blocks,
    droppedAttachments: [...droppedFiles, ...capped.droppedAttachments],
    reason: input.reason,
  };
}

function storageKey(key: string): string {
  return `${UNDELIVERED_STORAGE_PREFIX}${key}`;
}

export function readUndelivered(
  key: string,
  store: KeyValueStore = browserStorage,
): PlatformUndeliveredPrompt[] {
  const raw = safeGetItem(store, storageKey(key));
  if (raw === null) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    safeRemoveItem(store, storageKey(key));
    return [];
  }
  const parsed = persistedUndeliveredSchema.safeParse(json);
  if (!parsed.success) {
    safeRemoveItem(store, storageKey(key));
    return [];
  }
  return parsed.data.sends;
}

function writeUndelivered(
  key: string,
  sends: PlatformUndeliveredPrompt[],
  store: KeyValueStore,
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
  safeRemoveItem(store, storageKey(key));
}

export function rememberUndelivered(
  key: string,
  send: PlatformUndeliveredPrompt,
  store: KeyValueStore = browserStorage,
): void {
  const kept = readUndelivered(key, store).filter((s) => s.id !== send.id);
  writeUndelivered(key, [...kept, send], store);
}

export function forgetUndelivered(
  key: string,
  id: string,
  store: KeyValueStore = browserStorage,
): void {
  const kept = readUndelivered(key, store).filter((s) => s.id !== id);
  writeUndelivered(key, kept, store);
}

export function clearUndelivered(
  key: string,
  store: KeyValueStore = browserStorage,
): void {
  safeRemoveItem(store, storageKey(key));
}

export function removeAllUndelivered(
  store: KeyValueStore = browserStorage,
): void {
  removeAllWithPrefix(store, UNDELIVERED_STORAGE_PREFIX);
}
