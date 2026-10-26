import { z } from "zod";
import {
  senderSchema,
  sessionDefaultKind,
  sessionSettingsSchema,
  type Sender,
} from "agent-runtime-api";
import {
  platformSenderEntrySchema,
  platformVerdictSchema,
  type PlatformSenderEntry,
  type PlatformVerdict,
} from "api-server-api";
import type { DocumentStoreBackend } from "../../../core/document-store.js";

export const platformSessionMetaSchema = z.object({
  mode: z.string().optional(),
  type: z.string().optional(),
  scheduleId: z.string().optional(),
  initialization: z.boolean().optional(),
  threadTs: z.string().optional(),
  ref: z.string().optional(),
  reportTo: z.string().optional(),
  reportName: z.string().optional(),
  fireEvent: z.string().optional(),
  harness: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  settings: sessionSettingsSchema.optional(),
  follows: sessionDefaultKind.nullable().optional(),
  followsAfter: z.number().int().nonnegative().optional(),
  title: z.string().optional(),
  customTitle: z.string().optional(),
});

const sessionMetaEntrySchema = z.object({
  meta: platformSessionMetaSchema.catch({}),
  createdAt: z.string(),
  lastActivityAt: z.string().optional(),
  seenAt: z.string().optional(),
  runStartedAt: z.string().optional(),
  runTotalMs: z.number().optional(),
  runCount: z.number().optional(),
  runStarts: z.array(z.string()).optional(),
  unstored: z.boolean().optional(),
  senders: z.array(platformSenderEntrySchema).optional().catch(undefined),
  starter: senderSchema.optional().catch(undefined),
  verdicts: z.array(platformVerdictSchema).optional().catch(undefined),
});

const RUN_STARTS_CAP = 500;
const SENDERS_CAP = 500;
const VERDICTS_CAP = 500;

const sessionMetadataStateSchema = z
  .object({
    sessions: z.record(z.string(), z.unknown()).default({}),
    tombstones: z.array(z.string()).default([]),
  })
  .transform(({ sessions, tombstones }) => {
    const valid: Record<string, SessionMetaEntry> = {};
    for (const [sessionId, entry] of Object.entries(sessions)) {
      const result = sessionMetaEntrySchema.safeParse(entry);
      if (result.success) valid[sessionId] = result.data;
    }
    return { sessions: valid, tombstones };
  });

export type PlatformSessionMeta = z.infer<typeof platformSessionMetaSchema>;
export type SessionMetaEntry = z.infer<typeof sessionMetaEntrySchema>;

export interface SessionMetadataStore {
  get(sessionId: string): SessionMetaEntry | undefined;
  findByRef(ref: string): string | undefined;
  set(sessionId: string, meta: PlatformSessionMeta): void;
  recordActivity(sessionId: string): void;
  recordSeen(sessionId: string): void;
  startRun(sessionId: string): string | null;
  finishRun(sessionId: string): void;
  runStartsOf(sessionId: string): string[];
  recordSender(sessionId: string, entry: PlatformSenderEntry): void;
  sendersOf(sessionId: string): PlatformSenderEntry[];
  recordVerdict(sessionId: string, verdict: PlatformVerdict): void;
  verdictsOf(sessionId: string): PlatformVerdict[];
  copyAttribution(
    sessionId: string,
    fromSessionId: string,
    opts: { starter: boolean },
  ): void;
  markUnstored(sessionId: string): void;
  markStored(sessionId: string): void;
  clearFireEvent(sessionId: string): void;
  all(): Record<string, SessionMetaEntry>;
  adopt(
    sessionId: string,
    fromSessionId: string,
    meta: PlatformSessionMeta,
  ): void;
  tombstone(sessionId: string): void;
  isTombstoned(sessionId: string): boolean;
}

export function createSessionMetadataStore(
  backend: DocumentStoreBackend,
  now: () => string = () => new Date().toISOString(),
): SessionMetadataStore {
  const store = backend.open("session-metadata", {
    schema: sessionMetadataStateSchema,
    initial: () => ({ sessions: {}, tombstones: [] }),
  });

  {
    const { sessions, tombstones } = store.read();
    const stale = Object.values(sessions).some(
      (e) => e.seenAt === undefined || e.runStartedAt !== undefined,
    );
    if (stale) {
      const fixed: Record<string, SessionMetaEntry> = {};
      for (const [id, e] of Object.entries(sessions)) {
        const { runStartedAt: _abandoned, ...rest } = e;
        fixed[id] = {
          ...rest,
          seenAt: e.seenAt ?? e.lastActivityAt ?? e.createdAt,
        };
      }
      store.write({ sessions: fixed, tombstones });
    }
  }

  return {
    get(sessionId) {
      return store.read().sessions[sessionId];
    },
    findByRef(ref) {
      const { sessions, tombstones } = store.read();
      const dead = new Set(tombstones);
      for (const [sessionId, entry] of Object.entries(sessions)) {
        if (entry.meta.ref === ref && !dead.has(sessionId)) return sessionId;
      }
      return undefined;
    },
    set(sessionId, meta) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      const lease = existing?.meta;
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: {
            ...existing,
            meta: {
              ...(lease?.harness !== undefined && { harness: lease.harness }),
              ...(lease?.provider !== undefined && {
                provider: lease.provider,
              }),
              ...(lease?.model !== undefined && { model: lease.model }),
              ...meta,
            },
            createdAt: existing?.createdAt ?? now(),
            seenAt: existing?.seenAt ?? now(),
          },
        },
      });
    },
    adopt(sessionId, fromSessionId, meta) {
      const { sessions, tombstones } = store.read();
      const from = sessions[fromSessionId];
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: {
            meta,
            createdAt: from?.createdAt ?? now(),
            seenAt: now(),
            lastActivityAt: now(),
          },
        },
      });
    },
    recordActivity(sessionId) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      if (!existing) return;
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: { ...existing, lastActivityAt: now() },
        },
      });
    },
    recordSeen(sessionId) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      if (!existing) return;
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: { ...existing, seenAt: now() },
        },
      });
    },
    startRun(sessionId) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      if (!existing || existing.runStartedAt) return null;
      const stamp = now();
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: {
            ...existing,
            runStartedAt: stamp,
            runStarts: [...(existing.runStarts ?? []), stamp].slice(
              -RUN_STARTS_CAP,
            ),
          },
        },
      });
      return stamp;
    },
    finishRun(sessionId) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      if (!existing?.runStartedAt) return;
      const { runStartedAt, ...rest } = existing;
      const measured = Date.parse(now()) - Date.parse(runStartedAt);
      const elapsed = Number.isFinite(measured) ? measured : 0;
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: {
            ...rest,
            runTotalMs: (existing.runTotalMs ?? 0) + Math.max(0, elapsed),
            runCount: (existing.runCount ?? 0) + 1,
          },
        },
      });
    },
    runStartsOf(sessionId) {
      return [...(store.read().sessions[sessionId]?.runStarts ?? [])];
    },
    recordSender(sessionId, entry) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      if (!existing) return;
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: {
            ...existing,
            senders: [...(existing.senders ?? []), entry].slice(-SENDERS_CAP),
            starter: existing.starter ?? entry.sender,
          },
        },
      });
    },
    sendersOf(sessionId) {
      return [...(store.read().sessions[sessionId]?.senders ?? [])];
    },
    recordVerdict(sessionId, verdict) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      if (!existing) return;
      const others = (existing.verdicts ?? []).filter(
        (v) => v.toolCallId !== verdict.toolCallId,
      );
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: {
            ...existing,
            verdicts: [...others, verdict].slice(-VERDICTS_CAP),
          },
        },
      });
    },
    verdictsOf(sessionId) {
      return [...(store.read().sessions[sessionId]?.verdicts ?? [])];
    },
    copyAttribution(sessionId, fromSessionId, opts) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      const from = sessions[fromSessionId];
      if (!existing || !from) return;
      const starter: Sender | undefined = opts.starter
        ? from.starter
        : existing.starter;
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: {
            ...existing,
            ...(from.senders !== undefined && { senders: from.senders }),
            ...(from.verdicts !== undefined && { verdicts: from.verdicts }),
            ...(starter !== undefined && { starter }),
          },
        },
      });
    },
    markUnstored(sessionId) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      if (!existing || existing.unstored) return;
      store.write({
        tombstones,
        sessions: { ...sessions, [sessionId]: { ...existing, unstored: true } },
      });
    },
    clearFireEvent(sessionId) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      if (existing?.meta.fireEvent === undefined) return;
      const { fireEvent: _fired, ...meta } = existing.meta;
      store.write({
        tombstones,
        sessions: { ...sessions, [sessionId]: { ...existing, meta } },
      });
    },
    markStored(sessionId) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      if (!existing?.unstored) return;
      const { unstored: _stored, ...rest } = existing;
      store.write({ tombstones, sessions: { ...sessions, [sessionId]: rest } });
    },
    all() {
      return store.read().sessions;
    },
    tombstone(sessionId) {
      const { sessions, tombstones } = store.read();
      if (tombstones.includes(sessionId)) return;
      const next = { ...sessions };
      delete next[sessionId];
      store.write({ sessions: next, tombstones: [...tombstones, sessionId] });
    },
    isTombstoned(sessionId) {
      return store.read().tombstones.includes(sessionId);
    },
  };
}
