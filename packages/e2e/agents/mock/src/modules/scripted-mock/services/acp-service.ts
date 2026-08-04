import { randomUUID } from "node:crypto";
import { isRequest, parseFrame, type JsonRpcId } from "../domain/frames.js";
import type { MockState } from "../domain/state.js";
import { recordPrompt, type ProxyFetch } from "./control-service.js";
import type {
  AcpChannel,
  ProcessRunner,
  SlackReplyPoster,
  WorkspaceWriter,
} from "./ports.js";

const FETCH_DIRECTIVE = /__FETCH__\s+(\S+)/;
/** The Slack turn contract injects the thread id; its presence marks a turn
 *  whose reply must go out through the `reply` tool, not plain ACP text. */
const SLACK_THREAD_DIRECTIVE = /threadTs="([^"]+)"/;
/** E2e directive: run a python script (written via scriptFiles) to
 *  completion — how a spec drives experiment plan registration in-pod. */
const PYRUN_DIRECTIVE = /__PYRUN__\s+(\S+)/;
/** The Experiments Execute launch prompt (#2942) — recognize the composed
 *  command line and behave like a real harness: start the script detached
 *  with the run id in its environment, then end the turn. */
const EXPERIMENT_LAUNCH_DIRECTIVE =
  /PLATFORM_EXPERIMENT_ID=(\S+)\s+python3\s+(\S+)/;

export interface AcpServiceDeps {
  channel: AcpChannel;
  state: MockState;
  workspace: WorkspaceWriter;
  proxyFetch: ProxyFetch;
  processRunner: ProcessRunner;
  /** Posts to Slack via the reply tool; omitted outside channel turns. */
  slackReply?: SlackReplyPoster;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  newSessionId?: () => string;
}

export function startAcpService(deps: AcpServiceDeps): void {
  const now = deps.now ?? (() => new Date());
  const sleep =
    deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const newSessionId = deps.newSessionId ?? (() => randomUUID());
  const knownSessions = new Set<string>();

  deps.channel.onLine((line) => {
    void handleLine(line);
  });

  async function handleLine(line: string): Promise<void> {
    const frame = parseFrame(line);
    if (!frame || !isRequest(frame)) return;
    const { id, method, params } = frame;
    try {
      switch (method) {
        case "initialize":
          respondInitialize(id);
          return;
        case "authenticate":
          respond(id, null);
          return;
        case "session/new": {
          const sid = newSessionId();
          knownSessions.add(sid);
          respond(id, { sessionId: sid });
          return;
        }
        case "session/load": {
          const sid = extractSessionId(params);
          if (sid) knownSessions.add(sid);
          respond(id, {});
          return;
        }
        case "session/list":
          // Bare ids are enough: the runtime enriches each entry with its
          // stored `_meta.platform` (mode, activity, running) on the way out,
          // which is what the sessions sidebar decodes. Without this a
          // reloaded tab can never pick a session back up on a mock agent —
          // the sidebar stays "No sessions yet" forever.
          respond(id, {
            sessions: [...knownSessions].map((sessionId) => ({ sessionId })),
          });
          return;
        case "session/prompt":
          await handlePrompt(id, params);
          return;
        case "session/close": {
          const sid = extractSessionId(params);
          if (sid) knownSessions.delete(sid);
          respond(id, null);
          return;
        }
        case "session/cancel":
          respond(id, null);
          return;
        default:
          respondError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      respondError(
        id,
        -32603,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handlePrompt(id: JsonRpcId, params: unknown): Promise<void> {
    const sid = extractSessionId(params);
    if (!sid) {
      respondError(id, -32602, "missing sessionId");
      return;
    }
    const promptPayload = (params as { prompt?: unknown }).prompt;
    recordPrompt(deps.state, {
      sessionId: sid,
      receivedAt: now().toISOString(),
      prompt: promptPayload,
    });

    const promptStr = promptText(promptPayload);
    // On a Slack turn the reply must go out via the `reply` tool — plain ACP
    // text is not delivered to the channel. We still emit the ACP text so UI /
    // transcript views keep working.
    const slackThreadTs = SLACK_THREAD_DIRECTIVE.exec(promptStr)?.[1];

    const fetchUrl = FETCH_DIRECTIVE.exec(promptStr)?.[1];
    if (fetchUrl) {
      const text = await replyWithFetch(sid, fetchUrl);
      await maybeSlackReply(text, slackThreadTs);
      respond(id, { stopReason: "end_turn" });
      return;
    }

    for (const file of deps.state.scriptFiles) {
      await deps.workspace.writeFile(file.path, file.content);
    }

    const launch = EXPERIMENT_LAUNCH_DIRECTIVE.exec(promptStr);
    if (launch) {
      deps.processRunner.spawnDetached({
        command: "python3",
        args: [launch[2]!],
        env: { PLATFORM_EXPERIMENT_ID: launch[1]! },
        logPath: `${launch[2]!}.log`,
      });
      emitText(sid, `experiment ${launch[1]!} started`);
      respond(id, { stopReason: "end_turn" });
      return;
    }

    const pyrunPath = PYRUN_DIRECTIVE.exec(promptStr)?.[1];
    if (pyrunPath) {
      const { code, output } = await deps.processRunner.run({
        command: "python3",
        args: [pyrunPath],
        timeoutMs: 60_000,
      });
      emitText(sid, `[pyrun exit ${code}] ${output}`);
      respond(id, { stopReason: "end_turn" });
      return;
    }

    for (const entry of deps.state.scriptEntries) {
      if (entry.delayMs && entry.delayMs > 0) await sleep(entry.delayMs);
      notify("session/update", {
        sessionId: sid,
        update: entry.sessionUpdate,
      });
    }

    await maybeSlackReply(scriptedReplyText(deps.state), slackThreadTs);
    respond(id, { stopReason: deps.state.scriptStopReason });
  }

  /** Post the turn's reply through the Slack `reply` tool, when this is a Slack
   *  turn and there is something to say (empty → the mock stays silent). */
  async function maybeSlackReply(
    text: string,
    threadTs: string | undefined,
  ): Promise<void> {
    if (!threadTs || !deps.slackReply || text.trim() === "") return;
    await deps.slackReply({ text, threadTs });
  }

  function emitText(sid: string, text: string): void {
    notify("session/update", {
      sessionId: sid,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    });
  }

  async function replyWithFetch(sid: string, url: string): Promise<string> {
    let text: string;
    try {
      const { status, body } = await deps.proxyFetch({ url });
      text = `[fetch ${status}] ${body}`;
    } catch (err) {
      text = `[fetch error] ${err instanceof Error ? err.message : String(err)}`;
    }
    notify("session/update", {
      sessionId: sid,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    });
    return text;
  }

  function respondInitialize(id: JsonRpcId): void {
    respond(id, {
      protocolVersion: 1,
      agentCapabilities: { sessionCapabilities: { close: {} } },
    });
  }

  function respond(id: JsonRpcId, result: unknown): void {
    deps.channel.send({ jsonrpc: "2.0", id, result });
  }

  function respondError(id: JsonRpcId, code: number, message: string): void {
    deps.channel.send({ jsonrpc: "2.0", id, error: { code, message } });
  }

  function notify(method: string, params: unknown): void {
    deps.channel.send({ jsonrpc: "2.0", method, params });
  }
}

function extractSessionId(params: unknown): string | null {
  if (!params || typeof params !== "object") return null;
  const sid = (params as { sessionId?: unknown }).sessionId;
  return typeof sid === "string" ? sid : null;
}

/** The reply text a scripted turn would show: the concatenation of its
 *  agent_message_chunk text. Empty when the script emits no assistant text
 *  (the mock then stays silent on Slack, like calling no_reply_needed). */
function scriptedReplyText(state: MockState): string {
  let out = "";
  for (const entry of state.scriptEntries) {
    const update = entry.sessionUpdate as {
      sessionUpdate?: unknown;
      content?: { type?: unknown; text?: unknown };
    };
    if (
      update.sessionUpdate === "agent_message_chunk" &&
      update.content?.type === "text" &&
      typeof update.content.text === "string"
    ) {
      out += update.content.text;
    }
  }
  return out;
}

function promptText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!Array.isArray(payload)) return "";
  return payload
    .map((block) =>
      block && typeof block === "object" && "text" in block
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
    .join("\n");
}
