import { baseUrl } from "./config.js";

interface Frame {
  id?: number;
  method?: string;
  params?: {
    update?: {
      sessionUpdate?: string;
      content?: { type?: string; text?: string };
    };
  };
  result?: { sessionId?: string; stopReason?: string };
  error?: unknown;
}

export interface Turn {
  reply: string;
  stopReason: string;
  sessionId: string;
  frames: Frame[];
}

const turnTimeoutMs = 240_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: one chat turn with an Agent through the same ACP relay the web UI uses, `/api/agents/<id>/acp`: initialize, open a Session, send one prompt, and collect the Agent's message chunks until the prompt's answer names its stop reason. Every frame is kept, so a failed example carries the whole exchange.
 */
export async function promptOnce(
  agentId: string,
  token: string,
  text: string,
): Promise<Turn> {
  const url = `${baseUrl.replace(/^http/, "ws")}/api/agents/${agentId}/acp?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  const frames: Frame[] = [];
  let next = 0;
  const send = (method: string, params: object) =>
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: ++next, method, params }));
  try {
    return await new Promise<Turn>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `no end of turn within ${turnTimeoutMs}ms: ${JSON.stringify(frames)}`,
            ),
          ),
        turnTimeoutMs,
      );
      const fail = (message: string) => {
        done = true;
        clearTimeout(timer);
        reject(new Error(`${message}: ${JSON.stringify(frames)}`));
      };
      let reply = "";
      let sessionId = "";
      ws.onopen = () =>
        send("initialize", { protocolVersion: 1, clientCapabilities: {} });
      ws.onerror = () => fail("the ACP relay failed the connection");
      ws.onclose = (event) => {
        if (!done)
          fail(
            `the ACP relay closed the connection (${event.code} ${event.reason})`,
          );
      };
      ws.onmessage = (event) => {
        const frame = JSON.parse(String(event.data)) as Frame;
        frames.push(frame);
        const update = frame.params?.update;
        if (
          frame.method === "session/update" &&
          update?.sessionUpdate === "agent_message_chunk" &&
          update.content?.type === "text"
        )
          reply += update.content.text ?? "";
        if (frame.id === undefined || frame.method !== undefined) return;
        if (frame.error !== undefined)
          return fail(`request ${frame.id} failed`);
        if (frame.id === 1)
          send("session/new", { cwd: "/home/agent/work", mcpServers: [] });
        if (frame.id === 2) sessionId = frame.result?.sessionId ?? "";
        if (frame.id === 2)
          send("session/prompt", {
            sessionId: frame.result?.sessionId,
            prompt: [{ type: "text", text }],
          });
        if (frame.id === 3) {
          done = true;
          clearTimeout(timer);
          resolve({
            reply,
            stopReason: frame.result?.stopReason ?? "",
            sessionId,
            frames,
          });
        }
      };
    });
  } finally {
    ws.close();
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one ACP request to an Agent through its relay, after `initialize`, as the web UI sends its session list and delete: the request's result, or its error as a thrown Error.
 */
export async function acpRequest(
  agentId: string,
  token: string,
  method: string,
  params: object,
): Promise<Record<string, unknown>> {
  const url = `${baseUrl.replace(/^http/, "ws")}/api/agents/${agentId}/acp?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(`${method} got no answer within ${turnTimeoutMs}ms`),
          ),
        turnTimeoutMs,
      );
      const send = (id: number, m: string, p: object) =>
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: m, params: p }));
      ws.onopen = () =>
        send(1, "initialize", { protocolVersion: 1, clientCapabilities: {} });
      ws.onerror = () => reject(new Error(`${method}: the ACP relay failed`));
      ws.onmessage = (event) => {
        const frame = JSON.parse(String(event.data)) as {
          id?: number;
          method?: string;
          result?: Record<string, unknown>;
          error?: unknown;
        };
        if (frame.id === undefined || frame.method !== undefined) return;
        if (frame.error !== undefined) {
          clearTimeout(timer);
          reject(new Error(`${method}: ${JSON.stringify(frame.error)}`));
        } else if (frame.id === 1) send(2, method, params);
        else if (frame.id === 2) {
          clearTimeout(timer);
          resolve(frame.result ?? {});
        }
      };
    });
  } finally {
    ws.close();
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one chat turn that waits out a harness the agent is recycling for an environment change: the relay closes a connection a recycle cuts short, and the turn is sent again, at most three times.
 */
export async function promptWhenSettled(
  agentId: string,
  token: string,
  text: string,
): Promise<Turn> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await promptOnce(agentId, token, text);
    } catch (error) {
      if (attempt >= 3 || !String(error).includes("recycled")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}
