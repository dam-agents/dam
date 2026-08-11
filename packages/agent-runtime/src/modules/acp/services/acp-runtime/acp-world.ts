import {
  createAcpRuntime,
  type AcpRuntime,
  type AcpRuntimeDeps,
} from "./acp-runtime.js";
import type { AgentProcess } from "../../infrastructure/agent-process.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";

/**
 * Test doubles for the two ports the ACP runtime talks through, plus a world
 * that wires them to a real runtime.
 *
 * These are fakes, not mocks: they implement the port and record what passed
 * through, and the test asserts afterwards. The runtime reads `isOpen()` on
 * every fan-out, so a channel double has to model the open/closed transition
 * rather than stub it.
 *
 * **The rule this file exists to enforce:** never reach a frame by its
 * position. `harness.received("session/prompt")` survives a refactor that
 * reorders or adds frames; `agent.sent[1]` does not. Every accessor here
 * resolves by method, never by index.
 */

/** A decoded JSON-RPC frame. */
export type Frame = Record<string, unknown> & { method?: string; id?: unknown };

export interface Harness {
  /** Frames the runtime forwarded, all of them or just one method's. */
  received(method?: string): Frame[];
  /** Methods in forward order. Responses (which carry no method) read as `<response>`. */
  receivedMethods(): string[];
  /** Answer the most recent request of this method, matching its id. */
  replyTo(method: string, result?: unknown): void;
  /** Push a raw line as if the harness wrote it to stdout. */
  pushLine(line: string): void;
  /** The subprocess died on its own. */
  exit(): void;
  killed(): boolean;
}

function createHarness(): { harness: Harness; process: AgentProcess } {
  const lineHandlers: ((line: string) => void)[] = [];
  const sent: Frame[] = [];
  let killed = false;
  let resolveExit: () => void = () => {};
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const process: AgentProcess = {
    send(frame) {
      sent.push(frame as Frame);
    },
    onLine(handler) {
      lineHandlers.push(handler);
    },
    kill() {
      killed = true;
      resolveExit();
    },
    exited,
  };

  const received = (method?: string): Frame[] =>
    method === undefined ? [...sent] : sent.filter((f) => f.method === method);

  const harness: Harness = {
    received,
    receivedMethods: () =>
      sent.map((f) => (typeof f.method === "string" ? f.method : "<response>")),
    replyTo(method, result = {}) {
      const matching = received(method);
      const last = matching[matching.length - 1];
      if (last === undefined) {
        throw new Error(`no ${method} was ever forwarded to the harness`);
      }
      harness.pushLine(JSON.stringify({ jsonrpc: "2.0", id: last.id, result }));
    },
    pushLine(line) {
      for (const handler of lineHandlers) handler(line);
    },
    exit: () => resolveExit(),
    killed: () => killed,
  };

  return { harness, process };
}

export interface Client {
  /** Send a frame the way a real client would. */
  send(frame: object): void;
  /** Frames this client received, filtered by method. */
  saw(method: string): Frame[];
  /** Close code and reason, in the order they arrived. */
  closes: { code?: number; reason?: string }[];
  isOpen(): boolean;
  /** The socket dropped from the client's side. */
  disconnect(): void;
}

function createClient(): { client: Client; channel: ClientChannel } {
  const messageHandlers: ((data: string) => void)[] = [];
  const closeHandlers: (() => void)[] = [];
  const sent: string[] = [];
  const closes: { code?: number; reason?: string }[] = [];
  let open = true;

  const close = (code?: number, reason?: string): void => {
    if (!open) return;
    open = false;
    closes.push({ code, reason });
    for (const handler of closeHandlers) handler();
  };

  const channel: ClientChannel = {
    send(line) {
      if (open) sent.push(line);
    },
    close,
    isOpen: () => open,
    onMessage(handler) {
      messageHandlers.push(handler);
    },
    onClose(handler) {
      closeHandlers.push(handler);
    },
  };

  const client: Client = {
    send(frame) {
      const data = JSON.stringify(frame);
      for (const handler of messageHandlers) handler(data);
    },
    saw(method) {
      return sent
        .map((line) => JSON.parse(line) as Frame)
        .filter((frame) => frame.method === method);
    },
    closes,
    isOpen: () => open,
    disconnect: () => close(1006, "client disconnected"),
  };

  return { client, channel };
}

export interface World {
  runtime: AcpRuntime;
  /** Attach a new client. `viewer: false` marks a machine-driven one. */
  connect(opts?: { viewer?: boolean }): Client;
  /** The harness currently serving this pod. Throws if none has started. */
  harness(): Harness;
  /** How many harnesses have been spawned over this world's life. */
  harnessCount(): number;
}

export function createWorld(
  overrides: Partial<Omit<AcpRuntimeDeps, "spawnAgent">> = {},
): World {
  const harnesses: Harness[] = [];

  const runtime = createAcpRuntime({
    workingDir: "/workspace",
    ...overrides,
    spawnAgent: () => {
      const { harness, process } = createHarness();
      harnesses.push(harness);
      return process;
    },
  });

  return {
    runtime,
    connect(opts) {
      const { client, channel } = createClient();
      runtime.attach(channel, opts);
      return client;
    },
    harness() {
      const current = harnesses[harnesses.length - 1];
      if (current === undefined) {
        throw new Error("no harness has been started yet");
      }
      return current;
    },
    harnessCount: () => harnesses.length,
  };
}

/** The frames the connecting scenarios need. Grows as features are added. */
export const frames = {
  initialize: (id: number) => ({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: { protocolVersion: 1 },
  }),
  newSession: (id: number) => ({
    jsonrpc: "2.0",
    id,
    method: "session/new",
    params: { cwd: "." },
  }),
  listSessions: (id: number) => ({
    jsonrpc: "2.0",
    id,
    method: "session/list",
    params: {},
  }),
};
