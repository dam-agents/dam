import { randomUUID } from "node:crypto";
import { isRequest, parseFrame, type JsonRpcId } from "../domain/frames.js";
import type { MockState } from "../domain/state.js";
import { recordPrompt } from "./control-service.js";
import type { AcpChannel } from "./ports.js";

export interface AcpServiceDeps {
  channel: AcpChannel;
  state: MockState;
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

    for (const entry of deps.state.scriptEntries) {
      if (entry.delayMs && entry.delayMs > 0) await sleep(entry.delayMs);
      notify("session/update", {
        sessionId: sid,
        update: entry.sessionUpdate,
      });
    }

    respond(id, { stopReason: deps.state.scriptStopReason });
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
