import { isAfterTs } from "./thread-catch-up.js";

export interface MessageEdit<M> {
  ts: string;
  threadTs: string | null;
  authorAgentId: string | null;
  message: M;
}

export interface EditReader {
  agentId: string;
  session: string;
  threadTs: string | null;
  since: string | null;
  carried: readonly string[];
}

export interface EditsRead<M> {
  owed: MessageEdit<M>[];
  settle(): void;
}

export interface MessageEdits<M> {
  note(channel: string, edit: MessageEdit<M>): void;
  tell(channel: string, ts: string, session: string): void;
  readBy(channel: string, reader: EditReader): EditsRead<M>;
}

export const MESSAGE_EDIT_TTL_MS = 48 * 60 * 60 * 1000;

const DEFAULT_MAX_PER_CHANNEL = 200;

const SWEEPS_PER_TTL = 8;

type Noted<M> = MessageEdit<M> & { told: Set<string>; expiresAt: number };

/**
 * UNIT_BOUNDARY_DESCRIPTION: The edits made to the messages of a Slack
 * conversation, kept until each Session reading there has the new text. A
 * Session reads a conversation when a turn is built for it: a thread's reader
 * reads that thread's edits, its opening message included, and a reader of
 * the channel outside threads reads the edits of top-level messages. Of the
 * edits noted by then, the Session is owed the ones to messages it was
 * already handed — at or below the newest message it has — and the turn
 * lists them. Every other one it reads fresh from Slack or is handed in that
 * turn, with its current text. Once the turn is delivered the read is
 * settled, and all of them count as told; a turn that fails settles nothing,
 * so the edits stay owed. An edit noted after the read is not settled by it.
 * An Agent's Sessions are told apart, because one Agent can hold a message
 * in several of them. The Agent that wrote a message, and a Session told of
 * an edit in a turn already running, are owed nothing. A later edit of the
 * same message replaces the earlier one and is owed to everyone again. The
 * record lives in memory, is capped per conversation and expires, because a
 * message read from Slack later already carries its current text.
 */
export function createMessageEdits<M>(
  opts: {
    ttlMs?: number;
    maxPerChannel?: number;
    now?: () => number;
  } = {},
): MessageEdits<M> {
  const ttlMs = opts.ttlMs ?? MESSAGE_EDIT_TTL_MS;
  const maxPerChannel = opts.maxPerChannel ?? DEFAULT_MAX_PER_CHANNEL;
  const now = opts.now ?? Date.now;
  const channels = new Map<string, Map<string, Noted<M>>>();
  let nextSweepAt = now() + ttlMs / SWEEPS_PER_TTL;

  function live(channel: string): Map<string, Noted<M>> | undefined {
    const edits = channels.get(channel);
    if (!edits) return undefined;
    const at = now();
    for (const [ts, edit] of edits) {
      if (edit.expiresAt <= at) edits.delete(ts);
    }
    if (edits.size === 0) {
      channels.delete(channel);
      return undefined;
    }
    return edits;
  }

  function sweep(): void {
    if (now() < nextSweepAt) return;
    nextSweepAt = now() + ttlMs / SWEEPS_PER_TTL;
    for (const channel of [...channels.keys()]) live(channel);
  }

  return {
    note(channel, edit) {
      sweep();
      const edits = live(channel) ?? new Map<string, Noted<M>>();
      channels.set(channel, edits);
      edits.delete(edit.ts);
      edits.set(edit.ts, {
        ...edit,
        told: new Set(),
        expiresAt: now() + ttlMs,
      });
      while (edits.size > maxPerChannel) {
        const oldest = edits.keys().next().value;
        if (oldest === undefined) break;
        edits.delete(oldest);
      }
    },

    tell(channel, ts, session) {
      live(channel)?.get(ts)?.told.add(session);
    },

    readBy(channel, reader) {
      const { since } = reader;
      const carried = new Set(reader.carried);
      const read = [...(live(channel)?.values() ?? [])].filter((edit) =>
        reader.threadTs === null
          ? edit.threadTs === null
          : (edit.threadTs ?? edit.ts) === reader.threadTs,
      );
      const owed =
        since === null
          ? []
          : read
              .filter(
                (edit) =>
                  edit.authorAgentId !== reader.agentId &&
                  !edit.told.has(reader.session) &&
                  !carried.has(edit.ts) &&
                  !isAfterTs(edit.ts, since),
              )
              .sort((a, b) => (isAfterTs(a.ts, b.ts) ? 1 : -1));
      return {
        owed,
        settle() {
          const edits = live(channel);
          for (const edit of read) {
            if (edits?.get(edit.ts) === edit) edit.told.add(reader.session);
          }
        },
      };
    },
  };
}
