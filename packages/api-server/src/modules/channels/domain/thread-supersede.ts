const SUPERSEDED_TTL_MS = 60 * 60_000;

const SUPERSEDED_PRUNE_AT = 5_000;

const ACTIVITY_TOOLS_CAP = 20;

export interface SupersededTurn {
  cancelled: boolean;
  tools: string[];
  replies: string[];
}

type RunningTurn = {
  channel: string;
  sessionKey: string;
  carries: () => readonly string[];
  claim?: (ts: string) => void;
  cancel: () => void;
  record: SupersededTurn;
  settled: Promise<void>;
};

export interface HeldTurn {
  noteTool(title: string | null): void;
  noteReplies(replies: readonly string[]): void;
  end(): void;
}

export interface ThreadSupersede {
  hold(
    agentId: string,
    turn: {
      channel: string;
      sessionKey: string;
      carries: () => readonly string[];
      claim?: (ts: string) => void;
      cancel: () => void;
    },
  ): HeldTurn;
  supersede(
    agentId: string,
    thread: { channel: string; rootTs: string; sessionKey: string },
  ): Promise<SupersededTurn[]> | null;
  isSuperseded(agentId: string, channel: string, ts: string): boolean;
}

/** UNIT_BOUNDARY_DESCRIPTION: Keeps one Agent from acting on a message twice at
 *  the same time — once in a turn that carries it outside any thread, and once
 *  in the thread a reply opened under it. A reply there is the same request
 *  coming back, often the part that matters ("grab it", a correction), but it
 *  runs in the thread's own queue and session, so nothing else stops the two
 *  turns running in parallel. The reply therefore supersedes that Agent's
 *  turns on the thread's opening message, and the thread's turn waits for them
 *  to end. One that carries the opener alone is cancelled, since the thread's
 *  turn reads the opener anyway and answers it with the reply; one carrying
 *  other messages too runs to its end, so those are not dropped. Either way
 *  the thread's turn is handed what each of them ran and posted, so it builds
 *  on that instead of repeating it. A turn not started yet leaves the opener
 *  out for that Agent, and a turn whose steer still holds the opener is told
 *  to take it back, so it starts no second delivery of it. Only that Agent's
 *  turns are touched — other Agents keep theirs — and only those in another
 *  session: turns in the thread's own session already run one at a time, and
 *  the session remembers them. */
export function createThreadSupersede(): ThreadSupersede {
  const running = new Map<string, Set<RunningTurn>>();
  const superseded = new Map<string, number>();

  const supersededKey = (agentId: string, channel: string, ts: string) =>
    `${agentId} ${channel} ${ts}`;

  function markSuperseded(key: string): void {
    const now = Date.now();
    if (superseded.size > SUPERSEDED_PRUNE_AT) {
      for (const [stale, expiresAt] of superseded) {
        if (expiresAt <= now) superseded.delete(stale);
      }
    }
    superseded.set(key, now + SUPERSEDED_TTL_MS);
  }

  return {
    hold(agentId, held) {
      let settle!: () => void;
      const turn: RunningTurn = {
        channel: held.channel,
        sessionKey: held.sessionKey,
        carries: held.carries,
        ...(held.claim && { claim: held.claim }),
        cancel: held.cancel,
        record: { cancelled: false, tools: [], replies: [] },
        settled: new Promise<void>((resolve) => {
          settle = resolve;
        }),
      };
      let live = running.get(agentId);
      if (!live) {
        live = new Set();
        running.set(agentId, live);
      }
      live.add(turn);
      return {
        noteTool(title) {
          const { tools } = turn.record;
          if (!title || tools.at(-1) === title) return;
          if (tools.length < ACTIVITY_TOOLS_CAP) tools.push(title);
        },
        noteReplies(replies) {
          turn.record.replies = [...replies];
        },
        end() {
          const live = running.get(agentId);
          if (live) {
            live.delete(turn);
            if (live.size === 0) running.delete(agentId);
          }
          settle();
        },
      };
    },

    supersede(agentId, thread) {
      markSuperseded(supersededKey(agentId, thread.channel, thread.rootTs));
      const carrying = [...(running.get(agentId) ?? [])].filter(
        (turn) =>
          turn.channel === thread.channel &&
          turn.sessionKey !== thread.sessionKey &&
          turn.carries().includes(thread.rootTs),
      );
      if (carrying.length === 0) return null;
      for (const turn of carrying) turn.claim?.(thread.rootTs);
      for (const turn of carrying) {
        if (turn.carries().length !== 1 || turn.record.cancelled) continue;
        turn.record.cancelled = true;
        turn.cancel();
      }
      return Promise.all(carrying.map((turn) => turn.settled)).then(() =>
        carrying.map((turn) => turn.record),
      );
    },

    isSuperseded(agentId, channel, ts) {
      const expiresAt = superseded.get(supersededKey(agentId, channel, ts));
      return expiresAt !== undefined && expiresAt > Date.now();
    },
  };
}
