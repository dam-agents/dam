import {
  createAcpRuntime,
  type AcpRuntime,
  type AcpRuntimeDeps,
} from "../acp-runtime.js";
import type { DocumentStoreBackend } from "../../../../../core/document-store.js";
import type { AgentProcess } from "../../../infrastructure/agent-process.js";
import type { ClientChannel } from "../../../infrastructure/client-channel.js";
import {
  createSessionMetadataStore,
  type SessionMetadataStore,
} from "../../../infrastructure/session-metadata-store.js";

export type Frame = Record<string, unknown> & { method?: string; id?: unknown };

export const IDLE_REAP_DELAY_MS = 3_000;

export interface Harness {
  received(method?: string): Frame[];
  receivedMethods(): string[];
  answersTo(id: number): Frame[];
  replyTo(method: string, result?: unknown): void;
  replyToSession(method: string, sessionId: string, result?: unknown): void;
  emit(frame: object): void;
  pushLine(line: string): void;
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
    answersTo: (id) =>
      sent.filter((f) => f.method === undefined && f.id === id),
    replyTo(method, result = {}) {
      const matching = received(method);
      const last = matching[matching.length - 1];
      if (last === undefined) {
        throw new Error(`no ${method} was ever forwarded to the harness`);
      }
      harness.emit({ jsonrpc: "2.0", id: last.id, result });
    },
    replyToSession(method, sessionId, result = {}) {
      const match = received(method).find(
        (f) =>
          (f.params as { sessionId?: string } | undefined)?.sessionId ===
          sessionId,
      );
      if (match === undefined) {
        throw new Error(
          `no ${method} for ${sessionId} was ever forwarded to the harness`,
        );
      }
      harness.emit({ jsonrpc: "2.0", id: match.id, result });
    },
    emit(frame) {
      harness.pushLine(JSON.stringify(frame));
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
  send(frame: object): void;
  saw(method: string): Frame[];
  reply(id: number): Frame | undefined;
  closes: { code?: number; reason?: string }[];
  isOpen(): boolean;
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
    reply(id) {
      return sent
        .map((line) => JSON.parse(line) as Frame)
        .find((frame) => frame.method === undefined && frame.id === id);
    },
    closes,
    isOpen: () => open,
    disconnect: () => close(1006, "client disconnected"),
  };

  return { client, channel };
}

export interface World {
  runtime: AcpRuntime;
  connect(opts?: { viewer?: boolean }): Client;
  harness(): Harness;
  harnessStarted(): boolean;
  harnessCount(): number;
}

export function createWorld(
  overrides: Partial<Omit<AcpRuntimeDeps, "spawnAgent">> = {},
): World {
  const harnesses: Harness[] = [];

  const runtime = createAcpRuntime({
    workingDir: "/workspace",
    idleReapDelayMs: IDLE_REAP_DELAY_MS,
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
    harnessStarted: () => harnesses.length > 0,
    harnessCount: () => harnesses.length,
  };
}

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
  loadSession: (id: number, sessionId: string) => ({
    jsonrpc: "2.0",
    id,
    method: "session/load",
    params: { sessionId, cwd: "." },
  }),
  prompt: (id: number, sessionId: string, text: string) => ({
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: { sessionId, prompt: [{ type: "text", text }] },
  }),
  requestPermission: (id: number, sessionId: string, tool = "bash") => ({
    jsonrpc: "2.0",
    id,
    method: "session/request_permission",
    params: {
      sessionId,
      toolCall: { toolCallId: `tc-${id}`, title: tool },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ],
    },
  }),
  permissionAnswer: (id: number, optionId = "allow") => ({
    jsonrpc: "2.0",
    id,
    result: { outcome: { outcome: "selected", optionId } },
  }),
  agentMessage: (sessionId: string, text: string) => ({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  }),
};

export function promptTextsOf(harness: Harness): string[] {
  return harness.received("session/prompt").map((frame) => {
    const params = frame.params as { prompt?: { text?: string }[] };
    return (params.prompt ?? []).map((block) => block.text ?? "").join("");
  });
}

export interface SessionMetadata {
  store: SessionMetadataStore;
  unread(sessionId: string): boolean;
}

export function createSessionMetadata(): SessionMetadata {
  let tick = 0;
  const backend: DocumentStoreBackend = {
    open(_name, opts) {
      let state = opts.initial();
      return {
        read: () => state,
        write(next) {
          state = next;
        },
      };
    },
  };
  const store = createSessionMetadataStore(
    backend,
    () => `t${String(++tick).padStart(6, "0")}`,
  );
  return {
    store,
    unread(sessionId) {
      const entry = store.get(sessionId);
      if (entry?.lastActivityAt === undefined || entry.seenAt === undefined) {
        return false;
      }
      return entry.lastActivityAt > entry.seenAt;
    },
  };
}

export function transcriptOf(client: Client): string[] {
  return client.saw("session/update").map((frame) => {
    const params = frame.params as {
      sessionId?: string;
      update?: { content?: { text?: string } };
    };
    return `${params.sessionId}: ${params.update?.content?.text}`;
  });
}
