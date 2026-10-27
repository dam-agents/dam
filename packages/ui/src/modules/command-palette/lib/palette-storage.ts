import { sessionModeSchema } from "api-server-api";
import { z } from "zod";

import {
  browserStorage,
  type KeyValueStore,
  removeAllWithPrefix,
  safeGetItem,
  safeRemoveItem,
  safeSetItem,
} from "../../../lib/safe-storage.js";

const NAMESPACE = "platform-command-palette:";
const KEY_PREFIX = `${NAMESPACE}v1:`;
export const SNAPSHOT_CAP = 200;
export const TITLE_MAX = 120;

export function readStored<T>(
  name: string,
  owner: string,
  schema: z.ZodType<T>,
  store: KeyValueStore = browserStorage,
): T | null {
  const raw = safeGetItem(store, KEY_PREFIX + name);
  if (raw === null) return null;
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {}
  const parsed = z.object({ owner: z.string(), data: schema }).safeParse(json);
  if (parsed.success && parsed.data.owner === owner) return parsed.data.data;
  safeRemoveItem(store, KEY_PREFIX + name);
  return null;
}

export function writeStored(
  name: string,
  owner: string,
  data: unknown,
  store: KeyValueStore = browserStorage,
): void {
  safeSetItem(store, KEY_PREFIX + name, JSON.stringify({ owner, data }));
}

export const indexedSessionSchema = z.object({
  agentId: z.string(),
  sessionId: z.string(),
  title: z.string().nullable(),
  mode: sessionModeSchema,
  activityAt: z.number(),
});
export type IndexedSession = z.infer<typeof indexedSessionSchema>;

export const indexedArtifactSchema = z.object({
  id: z.string(),
  title: z.string(),
  agentId: z.string().nullable(),
});
export type IndexedArtifact = z.infer<typeof indexedArtifactSchema>;

export function clearPaletteStorage(store: KeyValueStore = browserStorage) {
  removeAllWithPrefix(store, NAMESPACE);
}
