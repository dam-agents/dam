import type { PromptUpdate } from "../../../core/acp-client.js";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import type { SlackBlock, SlackGateway } from "./slack-gateway.js";

/** Status shown while the turn is getting underway / between tool activity. */
const THINKING = "is thinking…";
/** Status shown while the pod is cold-starting. */
const WAKING = "is waking the agent — this can take a minute or two…";

export interface TurnPresenterOpts {
  channel: string;
  /** Thread the reply streams into and the status attaches to. */
  threadTs: string;
  /** Rendered in the footer context block under the finished reply. */
  instanceName: string;
  /** Both ids are required to stream into a channel; absent → post the whole
   *  reply at the end (no stream, no partial-typing effect). */
  recipient?: { teamId?: string; userId?: string };
  /** Flush the append buffer once it reaches this many characters. */
  flushMaxChars?: number;
  /** …or this long after the first unflushed chunk, whichever comes first. */
  flushIntervalMs?: number;
  /** Minimum spacing between status API calls (a clear always goes through). */
  statusMinIntervalMs?: number;
  /** Re-assert the current status this often so it survives Slack's ~2-min
   *  expiry during a long silent tool. 0 disables the refresh. */
  statusRefreshMs?: number;
}

/** Coordinates one assistant turn's live Slack presentation: a running status
 *  and the reply streamed in as it is generated, with a clean fall back to a
 *  single end-of-turn message whenever streaming is unavailable or fails. */
export interface TurnPresenter {
  /** Fed each {@link PromptUpdate} from the ACP turn (fire-and-forget). */
  onUpdate(update: PromptUpdate): void;
  /** Set the baseline "is thinking…" status (call right after the 👀 ack). */
  setThinking(): void;
  /** Switch the status to the cold-start message during a wake. */
  setWaking(): void;
  /** Terminal success: close the stream with the tail + footer, or — when no
   *  chunk ever streamed — post the whole reply as one message. */
  finish(response: string): Promise<void>;
  /** Terminal failure: finalize any open stream so it isn't left dangling
   *  (the caller posts its own failure copy separately). */
  abortStream(): Promise<void>;
  /** Forget any stream started this attempt so a retry streams afresh. */
  resetStream(): Promise<void>;
  /** Clear the status; safe to call on every turn-exit path. */
  clearStatus(): Promise<void>;
}

/** Footer crediting the responding agent, matching the non-streamed reply. */
function contextBlock(instanceName: string): SlackBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: `_${instanceName}_` }],
  };
}

/** Blocks for the single end-of-turn message (no-stream / fallback path). */
export function renderAssistantBlocks(
  instanceName: string,
  text: string,
): SlackBlock[] {
  return [
    { type: "markdown", text: text || "(no response)" },
    contextBlock(instanceName),
  ];
}

export function createTurnPresenter(
  gw: SlackGateway,
  opts: TurnPresenterOpts,
): TurnPresenter {
  const { channel, threadTs, instanceName } = opts;
  const flushMaxChars = opts.flushMaxChars ?? 280;
  const flushIntervalMs = opts.flushIntervalMs ?? 800;
  const statusMinIntervalMs = opts.statusMinIntervalMs ?? 1_000;
  const statusRefreshMs = opts.statusRefreshMs ?? 75_000;

  // Streaming is only possible in a channel when Slack has both recipient ids;
  // without them a stream would be rejected, so don't attempt one.
  const canStream = !!(opts.recipient?.teamId && opts.recipient?.userId);

  // --- streaming state ---
  let streamTs: string | null = null;
  let streamBroken = false;
  let buffer = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  // Serializes every stream API call so appends never overlap or reorder.
  let tail: Promise<void> = Promise.resolve();
  let finished = false;

  // --- status state ---
  let statusDisabled = false;
  let currentStatus = "";
  let lastSentAt = 0;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  function clearFlushTimer() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function enqueueFlush() {
    clearFlushTimer();
    tail = tail.then(doFlush).catch((err) => {
      getLogger().debug(
        { err: formatError(err) },
        "slack stream flush errored",
      );
    });
  }

  async function doFlush() {
    if (finished || streamBroken || buffer === "") return;
    const text = buffer;
    buffer = "";
    if (streamTs === null) {
      try {
        const { ts } = await gw.startStream({
          channel,
          threadTs,
          recipientTeamId: opts.recipient?.teamId ?? "",
          recipientUserId: opts.recipient?.userId ?? "",
          markdownText: text,
        });
        streamTs = ts;
      } catch (err) {
        // Feature off, missing scope, or transient — keep the text for the
        // fallback post and stop trying to stream this turn.
        streamBroken = true;
        buffer = text + buffer;
        getLogger().warn(
          { agentId: instanceName, err: formatError(err) },
          "slack.stream.open_failed",
        );
      }
      return;
    }
    try {
      await gw.appendStream({ channel, ts: streamTs, markdownText: text });
    } catch (err) {
      // Mid-stream failure: close the dangling message and let finish() repost
      // the full reply as one message.
      streamBroken = true;
      const dangling = streamTs;
      streamTs = null;
      getLogger().warn(
        { agentId: instanceName, err: formatError(err) },
        "slack.stream.append_failed",
      );
      try {
        await gw.stopStream({ channel, ts: dangling });
      } catch {
        /* best effort */
      }
    }
  }

  function sendStatus(status: string) {
    if (statusDisabled) return;
    gw.setStatus({ channel, threadTs, status }).catch((err) => {
      // setStatus may be unsupported outside assistant threads; latch off so a
      // failing workspace doesn't spam the log or the API for the whole turn.
      statusDisabled = true;
      getLogger().debug(
        { agentId: instanceName, err: formatError(err) },
        "slack.status.failed (disabling status for this turn)",
      );
    });
    lastSentAt = nowMs();
  }

  function setStatus(status: string) {
    if (statusDisabled || finished || status === currentStatus) return;
    currentStatus = status;
    // Leading-edge send; coalesce bursts within the min interval into one
    // trailing send carrying the latest value.
    const elapsed = nowMs() - lastSentAt;
    if (elapsed >= statusMinIntervalMs) {
      if (statusTimer) {
        clearTimeout(statusTimer);
        statusTimer = null;
      }
      sendStatus(status);
    } else if (!statusTimer) {
      statusTimer = setTimeout(() => {
        statusTimer = null;
        if (!finished && !statusDisabled) sendStatus(currentStatus);
      }, statusMinIntervalMs - elapsed);
    }
    ensureRefresh();
  }

  function ensureRefresh() {
    if (statusRefreshMs <= 0 || refreshTimer || statusDisabled) return;
    refreshTimer = setInterval(() => {
      if (finished || statusDisabled || currentStatus === "") return;
      sendStatus(currentStatus);
    }, statusRefreshMs);
    // Don't keep the event loop alive on the refresh alone.
    (refreshTimer as { unref?: () => void }).unref?.();
  }

  function stopRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
  }

  return {
    onUpdate(update: PromptUpdate) {
      if (finished) return;
      switch (update.kind) {
        case "text":
          if (!canStream || streamBroken) return;
          buffer += update.text;
          if (buffer.length >= flushMaxChars) {
            enqueueFlush();
          } else if (!flushTimer) {
            flushTimer = setTimeout(enqueueFlush, flushIntervalMs);
          }
          return;
        case "thought":
          setStatus(THINKING);
          return;
        case "tool":
          setStatus(update.title ? truncate(update.title, 80) : "is working…");
          return;
      }
    },

    setThinking() {
      setStatus(THINKING);
    },

    setWaking() {
      setStatus(WAKING);
    },

    async finish(response: string) {
      finished = true;
      clearFlushTimer();
      stopRefresh();
      await tail;
      if (streamTs !== null && !streamBroken) {
        const remainder = buffer;
        buffer = "";
        try {
          await gw.stopStream({
            channel,
            ts: streamTs,
            ...(remainder ? { markdownText: remainder } : {}),
            blocks: [contextBlock(instanceName)],
          });
          streamTs = null;
          return;
        } catch (err) {
          // Couldn't cleanly close the stream — fall through to a full repost.
          getLogger().warn(
            { agentId: instanceName, err: formatError(err) },
            "slack.stream.stop_failed",
          );
          streamTs = null;
        }
      }
      // Never streamed (no chunks / no recipient / broken): post it all now.
      await gw.postMessage({
        channel,
        threadTs,
        text: response || "(no response)",
        blocks: renderAssistantBlocks(instanceName, response),
      });
    },

    async abortStream() {
      finished = true;
      clearFlushTimer();
      stopRefresh();
      await tail;
      if (streamTs !== null) {
        const remainder = buffer;
        try {
          await gw.stopStream({
            channel,
            ts: streamTs,
            ...(remainder ? { markdownText: remainder } : {}),
          });
        } catch (err) {
          getLogger().debug(
            { err: formatError(err) },
            "slack stream abort stop errored",
          );
        }
        streamTs = null;
      }
      buffer = "";
    },

    async resetStream() {
      clearFlushTimer();
      await tail;
      if (streamTs !== null) {
        try {
          await gw.stopStream({ channel, ts: streamTs });
        } catch (err) {
          getLogger().debug(
            { err: formatError(err) },
            "slack stream reset stop errored",
          );
        }
      }
      streamTs = null;
      buffer = "";
      streamBroken = false;
    },

    async clearStatus() {
      stopRefresh();
      if (statusDisabled || currentStatus === "") return;
      currentStatus = "";
      try {
        await gw.setStatus({ channel, threadTs, status: "" });
      } catch (err) {
        getLogger().debug(
          { err: formatError(err) },
          "slack status clear errored",
        );
      }
    },
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Wall clock, indirected so tests with fake timers stay deterministic. */
function nowMs(): number {
  return Date.now();
}
