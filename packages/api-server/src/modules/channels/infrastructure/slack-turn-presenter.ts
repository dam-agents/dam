import type { PromptUpdate } from "../../../core/acp-client.js";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import { agentContextBlock, type AgentFooter } from "./agent-footer.js";
import type { SlackBlock, SlackGateway } from "./slack-gateway.js";

const THINKING = "is thinking…";
const WAKING = "is waking the agent — this can take a minute or two…";

export interface TurnPresenterOpts {
  channel: string;
  threadTs: string;
  instanceName: string;
  statusMinIntervalMs?: number;
  statusRefreshMs?: number;
}

export interface TurnPresenter {
  onUpdate(update: PromptUpdate): void;
  setThinking(): void;
  setWaking(): void;
  clearStatus(): Promise<void>;
}

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

function nowMs(): number {
  return Date.now();
}
