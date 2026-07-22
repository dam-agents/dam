import type { PromptUpdate } from "../../../core/acp-client.js";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import { agentContextBlock, type AgentFooter } from "./agent-footer.js";
import type { SlackBlock, SlackGateway } from "./slack-gateway.js";

/** Status shown while the turn is getting underway / between tool activity. */
const THINKING = "is thinking…";
/** Status shown while the pod is cold-starting. */
const WAKING = "is waking the agent — this can take a minute or two…";

export interface TurnPresenterOpts {
  channel: string;
  /** Thread the status attaches to. */
  threadTs: string;
  /** Used only for log attribution. */
  instanceName: string;
  /** Minimum spacing between status API calls (a clear always goes through). */
  statusMinIntervalMs?: number;
  /** Re-assert the current status this often so it survives Slack's ~2-min
   *  expiry during a long silent tool. 0 disables the refresh. */
  statusRefreshMs?: number;
}

/** Drives the live "working" status for one assistant turn — the only thing
 *  the platform presents on the agent's behalf. The reply itself is never
 *  posted here: an agent reaches Slack only by calling the `reply`/`react`
 *  tools, so plain assistant text stays out of the channel. */
export interface TurnPresenter {
  /** Fed each {@link PromptUpdate} from the ACP turn (fire-and-forget). Drives
   *  the status line from `thought`/`tool` updates; assistant `text` is
   *  deliberately ignored — it is not delivered unless the agent calls a tool. */
  onUpdate(update: PromptUpdate): void;
  /** Set the baseline "is thinking…" status (call right after the 👀 ack). */
  setThinking(): void;
  /** Switch the status to the cold-start message during a wake. */
  setWaking(): void;
  /** Clear the status; safe to call on every turn-exit path. */
  clearStatus(): Promise<void>;
}

/** Blocks for a posted assistant reply (the `reply` tool's message): the text
 *  followed by the agent-attribution footer. */
export function renderAssistantBlocks(
  footer: AgentFooter,
  text: string,
): SlackBlock[] {
  return [
    { type: "markdown", text: text || "(no response)" },
    agentContextBlock(footer),
  ];
}

export function createTurnPresenter(
  gw: SlackGateway,
  opts: TurnPresenterOpts,
): TurnPresenter {
  const { channel, threadTs, instanceName } = opts;
  const statusMinIntervalMs = opts.statusMinIntervalMs ?? 1_000;
  const statusRefreshMs = opts.statusRefreshMs ?? 75_000;

  let finished = false;
  let statusDisabled = false;
  let currentStatus = "";
  let lastSentAt = 0;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

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

  function stopTimers() {
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
          // Assistant prose is not delivered to Slack — the agent posts by
          // calling the `reply` tool. Nothing to present here.
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

    async clearStatus() {
      finished = true;
      stopTimers();
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
