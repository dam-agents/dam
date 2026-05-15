import { describe, it, expect, vi } from "vitest";
import { createAcpRuntime } from "../../modules/acp/services/acp-runtime.js";
import type { AgentProcess } from "../../modules/acp/infrastructure/agent-process.js";
import type { ClientChannel } from "../../modules/acp/infrastructure/client-channel.js";

interface FakeAgent {
  agent: AgentProcess;
  pushLine(line: string): void;
  exit(): void;
  sent: unknown[];
  killed: () => boolean;
}

function makeFakeAgent(): FakeAgent {
  const handlers: ((line: string) => void)[] = [];
  let resolveExited: () => void = () => {};
  const exited = new Promise<void>((r) => { resolveExited = r; });
  const sent: unknown[] = [];
  let killedFlag = false;

  return {
    agent: {
      send(frame) { sent.push(frame); },
      onLine(h) { handlers.push(h); },
      kill() { killedFlag = true; resolveExited(); },
      exited,
    },
    pushLine(line) { for (const h of handlers) h(line); },
    exit() { resolveExited(); },
    sent,
    killed: () => killedFlag,
  };
}

interface FakeChannel {
  channel: ClientChannel;
  pushMessage(data: string): void;
  remoteClose(): void;
  sent: string[];
  closes: { code?: number; reason?: string }[];
  isOpen: () => boolean;
}

function makeFakeChannel(): FakeChannel {
  const msgHandlers: ((data: string) => void)[] = [];
  const closeHandlers: (() => void)[] = [];
  const sent: string[] = [];
  const closes: { code?: number; reason?: string }[] = [];
  let open = true;

  const close = (code?: number, reason?: string) => {
    if (!open) return;
    open = false;
    closes.push({ code, reason });
    for (const h of closeHandlers) h();
  };

  return {
    channel: {
      send(line) { if (open) sent.push(line); },
      close,
      isOpen() { return open; },
      onMessage(h) { msgHandlers.push(h); },
      onClose(h) { closeHandlers.push(h); },
    },
    pushMessage(data) { for (const h of msgHandlers) h(data); },
    remoteClose() { close(1006, "remote close"); },
    sent,
    closes,
    isOpen: () => open,
  };
}

const SID = "s1";
const OTHER_SID = "s2";

const newSessionRequest = (id: number) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "session/new", params: { cwd: "." } });

const newSessionResponse = (outboundId: number, sessionId = SID) =>
  JSON.stringify({ jsonrpc: "2.0", id: outboundId, result: { sessionId, modes: {}, models: {}, configOptions: [] } });

const resumeSessionRequest = (id: number, sessionId = SID) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "session/resume", params: { sessionId, cwd: "." } });

const listSessionsRequest = (id: number) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "session/list", params: {} });

const promptRequest = (id: number, sessionId = SID) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "session/prompt", params: { sessionId, prompt: [] } });

const permissionRequest = (id: number, sessionId = SID) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "session/request_permission",
    params: { sessionId, toolCall: { toolCallId: `tc-${id}` }, options: [] },
  });

const permissionResponse = (id: number) =>
  JSON.stringify({ jsonrpc: "2.0", id, result: { outcome: { outcome: "selected", optionId: "allow" } } });

const sessionUpdate = (sessionId = SID) =>
  JSON.stringify({ method: "session/update", params: { sessionId, update: { type: "message" } } });

const agentPromptResponse = (outboundId: number) =>
  JSON.stringify({ jsonrpc: "2.0", id: outboundId, result: { stopReason: "end_turn" } });

const initializeRequest = (id: number) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: 1 } });

const initializeResponse = (
  outboundId: number,
  sessionCapabilities: object | undefined,
) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: outboundId,
    result: {
      protocolVersion: 1,
      agentCapabilities: sessionCapabilities === undefined
        ? {}
        : { sessionCapabilities },
    },
  });

function outboundId(sentFrame: unknown): number {
  return (sentFrame as { id: number }).id;
}

/**
 * Complete a runtime-initiated cold-resume bootstrap. session/resume is
 * mediated by the runtime: a cold resume parks the channel as a waiter and
 * forwards a synthetic session/load to the agent. Tests need to push back
 * a load response so the bootstrap completes and engagement enters the
 * steady state where live notifications fan out normally.
 */
function completeResumeBootstrap(
  fa: FakeAgent,
  sessionId = SID,
  result: object = { modes: {}, models: {}, configOptions: [] },
): void {
  const loadFrames = fa.sent.filter(
    (f: any) => f.method === "session/load" && f.params?.sessionId === sessionId,
  );
  if (loadFrames.length === 0) {
    throw new Error(`completeResumeBootstrap: no pending session/load for ${sessionId}`);
  }
  const lastLoad = loadFrames[loadFrames.length - 1];
  fa.pushLine(JSON.stringify({ jsonrpc: "2.0", id: outboundId(lastLoad), result }));
}

describe("createAcpRuntime", () => {
  it("spawns the agent lazily on first attach", () => {
    let spawnCount = 0;
    const runtime = createAcpRuntime({
      spawnAgent: () => { spawnCount++; return makeFakeAgent().agent; },
      workingDir: "/tmp",
    });

    expect(spawnCount).toBe(0);
    expect(runtime.status().agentAlive).toBe(false);

    runtime.attach(makeFakeChannel().channel);
    expect(spawnCount).toBe(1);
    expect(runtime.status().agentAlive).toBe(true);
    expect(runtime.status().activeClientCount).toBe(1);
  });

  it("keeps the agent alive when a client disconnects", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.remoteClose();

    expect(fa.killed()).toBe(false);
    expect(runtime.status().agentAlive).toBe(true);
    expect(runtime.status().activeClientCount).toBe(0);
  });

  it("accepts multiple channels without evicting existing ones", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    expect(c1.isOpen()).toBe(true);
    expect(c2.isOpen()).toBe(true);
    expect(runtime.status().activeClientCount).toBe(2);
  });

  it("does not broadcast session traffic to a channel that hasn't engaged with that session", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const viewer = makeFakeChannel();
    const ops = makeFakeChannel();
    runtime.attach(viewer.channel);
    runtime.attach(ops.channel);

    // Only `viewer` engages with SID via a resume call.
    viewer.pushMessage(resumeSessionRequest(1));
    // `ops` calls `session/list` — no sessionId, no engagement.
    ops.pushMessage(listSessionsRequest(1));

    // Agent emits a permission request scoped to SID.
    fa.pushLine(permissionRequest(9));

    expect(viewer.sent.some((f) => JSON.parse(f).method === "session/request_permission")).toBe(true);
    expect(ops.sent.some((f) => JSON.parse(f).method === "session/request_permission")).toBe(false);
  });

  it("does not broadcast sessionUpdate notifications to a channel not engaged with the session", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const viewer = makeFakeChannel();
    const other = makeFakeChannel();
    runtime.attach(viewer.channel);
    runtime.attach(other.channel);

    viewer.pushMessage(resumeSessionRequest(1, SID));
    other.pushMessage(resumeSessionRequest(1, OTHER_SID));
    completeResumeBootstrap(fa, SID);
    completeResumeBootstrap(fa, OTHER_SID);

    fa.pushLine(sessionUpdate(SID));

    expect(viewer.sent.some((f) => JSON.parse(f).params?.sessionId === SID)).toBe(true);
    expect(other.sent.some((f) => JSON.parse(f).params?.sessionId === SID)).toBe(false);
  });

  it("engages a channel with the sessionId returned by session/new's response", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(newSessionRequest(1));

    const sent = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sent));

    // Now the agent emits something scoped to the new session — channel
    // should receive it because the response engaged it.
    fa.pushLine(sessionUpdate(SID));
    expect(c.sent.some((f) => JSON.parse(f).method === "session/update")).toBe(true);
  });

  it("replays pending agent requests to a channel only at engagement time", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    // Attach first so the agent process is spawned and its onLine handler is
    // wired. The channel isn't engaged with any session yet.
    const c = makeFakeChannel();
    runtime.attach(c.channel);

    // Agent emits a permission request while no channel is engaged with SID.
    fa.pushLine(permissionRequest(7));

    // Attach alone must NOT replay — the channel hasn't opted into this session.
    expect(c.sent.some((f) => f === permissionRequest(7))).toBe(false);

    // Engage via resume.
    c.pushMessage(resumeSessionRequest(1));
    expect(c.sent.some((f) => f === permissionRequest(7))).toBe(true);
  });

  it("replays pending agent requests to every viewer that engages with the session", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    runtime.attach(c1.channel);
    c1.pushMessage(resumeSessionRequest(1));
    fa.pushLine(permissionRequest(9));
    expect(c1.sent).toContain(permissionRequest(9));

    const c2 = makeFakeChannel();
    runtime.attach(c2.channel);
    c2.pushMessage(resumeSessionRequest(1));
    expect(c2.sent).toContain(permissionRequest(9));
  });

  it("accepts the first response to a permission request and drops later duplicates", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);
    c1.pushMessage(resumeSessionRequest(1));
    c2.pushMessage(resumeSessionRequest(1));

    fa.pushLine(permissionRequest(7));

    const countBefore = fa.sent.length;
    c1.pushMessage(permissionResponse(7));
    expect(fa.sent.length).toBe(countBefore + 1);

    // A late response from c2 must not reach the agent again.
    c2.pushMessage(permissionResponse(7));
    expect(fa.sent.length).toBe(countBefore + 1);
  });

  it("rewrites client request ids so concurrent clients cannot collide at the agent", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(newSessionRequest(1));
    c2.pushMessage(newSessionRequest(1));

    expect(fa.sent).toHaveLength(2);
    const id1 = outboundId(fa.sent[0]);
    const id2 = outboundId(fa.sent[1]);
    expect(id1).not.toBe(id2);
  });

  it("translates agent responses back to the originating client's id", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(newSessionRequest(7));

    const sent = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sent));

    const forwarded = JSON.parse(c.sent.at(-1)!) as { id: number; result: { sessionId: string } };
    expect(forwarded.id).toBe(7);
    expect(forwarded.result.sessionId).toBe(SID);
  });

  it("forwards only the first prompt for a session and queues subsequent ones", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(promptRequest(1));
    c2.pushMessage(promptRequest(1));

    expect(fa.sent).toHaveLength(1);
    expect(runtime.status().queuedPromptCount).toBe(1);
  });

  it("advances the queue when the active prompt's response arrives", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(promptRequest(1));
    c2.pushMessage(promptRequest(1));

    const first = outboundId(fa.sent[0]);
    fa.pushLine(agentPromptResponse(first));

    expect(fa.sent).toHaveLength(2);
    expect(runtime.status().queuedPromptCount).toBe(0);
  });

  it("lets prompts for different sessions run in parallel", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);

    c.pushMessage(promptRequest(1, SID));
    c.pushMessage(promptRequest(2, OTHER_SID));

    expect(fa.sent).toHaveLength(2);
    expect(runtime.status().queuedPromptCount).toBe(0);
  });

  it("drops queued prompts owned by a disconnecting client", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(promptRequest(1));
    c2.pushMessage(promptRequest(1));
    expect(runtime.status().queuedPromptCount).toBe(1);

    c2.remoteClose();
    expect(runtime.status().queuedPromptCount).toBe(0);
  });

  it("still advances the queue if the client owning the active prompt disconnects mid-prompt", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(promptRequest(1));
    c2.pushMessage(promptRequest(1));

    c1.remoteClose();

    const first = outboundId(fa.sent[0]);
    fa.pushLine(agentPromptResponse(first));

    expect(fa.sent).toHaveLength(2);
    expect(runtime.status().queuedPromptCount).toBe(0);
  });

  it("rejects prompts beyond the per-session queue cap with a JSON-RPC error", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);

    // 1 active + 32 queued = 33 accepted.
    for (let i = 1; i <= 33; i++) c.pushMessage(promptRequest(i));
    expect(fa.sent).toHaveLength(1);
    expect(runtime.status().queuedPromptCount).toBe(32);

    c.pushMessage(promptRequest(34));
    const last = JSON.parse(c.sent.at(-1)!) as { id: number; error: { message: string } };
    expect(last.id).toBe(34);
    expect(last.error.message).toMatch(/queue full/);
    expect(fa.sent).toHaveLength(1);
  });

  it("drops client responses for ids that are not pending agent requests", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);

    c.pushMessage(JSON.stringify({ id: 999, result: { anything: true } }));
    expect(fa.sent).toHaveLength(0);
  });

  it("rewrites params.cwd on client frames before forwarding to the agent", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/pod/work" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(newSessionRequest(1));

    const sent = fa.sent[0] as { id: number; method: string; params: { cwd: string } };
    expect(sent.method).toBe("session/new");
    expect(sent.params.cwd).toBe("/pod/work");
  });

  it("drops non-JSON client messages and logs", () => {
    const fa = makeFakeAgent();
    const logs: string[] = [];
    const runtime = createAcpRuntime({
      spawnAgent: () => fa.agent,
      workingDir: "/tmp",
      log: (msg) => logs.push(msg),
    });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage("not-json");

    expect(fa.sent).toHaveLength(0);
    expect(logs.some((m) => m.includes("non-JSON"))).toBe(true);
  });

  it("does not auto-restart after the agent exits; subsequent attach closes the channel", async () => {
    const fa = makeFakeAgent();
    let spawnCount = 0;
    const runtime = createAcpRuntime({
      spawnAgent: () => { spawnCount++; return fa.agent; },
      workingDir: "/tmp",
    });

    const c1 = makeFakeChannel();
    runtime.attach(c1.channel);
    expect(spawnCount).toBe(1);

    fa.exit();
    await new Promise<void>((r) => setImmediate(r));
    expect(runtime.status().agentAlive).toBe(false);
    expect(c1.isOpen()).toBe(false);

    const c2 = makeFakeChannel();
    runtime.attach(c2.channel);
    expect(spawnCount).toBe(1);
    expect(c2.isOpen()).toBe(false);
    expect(c2.closes[0]).toMatchObject({ code: 1011 });
  });

  it("rewrites authentication_error text before forwarding to the client", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(resumeSessionRequest(1));
    completeResumeBootstrap(fa, SID);

    fa.pushLine(JSON.stringify({
      method: "session/update",
      params: { sessionId: SID, update: { content: { type: "text", text: "authentication_error: missing" } } },
    }));

    const forwarded = JSON.parse(c.sent.at(-1)!);
    expect(forwarded.params.update.content.text).toMatch(/Authentication Error:/);
  });

  it("expires a session's pending agent requests after the orphan TTL with no engaged channel", () => {
    vi.useFakeTimers();
    try {
      const fa = makeFakeAgent();
      const runtime = createAcpRuntime({
        spawnAgent: () => fa.agent,
        workingDir: "/tmp",
        orphanTtlMs: 100,
      });

      const c = makeFakeChannel();
      runtime.attach(c.channel);
      c.pushMessage(resumeSessionRequest(1));

      fa.pushLine(permissionRequest(5));
      expect(runtime.status().pendingRequestCount).toBe(1);

      c.remoteClose();

      vi.advanceTimersByTime(99);
      expect(fa.sent.some((f) => (f as { error?: unknown }).error)).toBe(false);

      vi.advanceTimersByTime(2);
      const errorSent = fa.sent.find((f) => (f as { error?: unknown }).error);
      expect(errorSent).toBeDefined();
      expect((errorSent as { id: number }).id).toBe(5);
      expect(runtime.status().pendingRequestCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the orphan timer when a viewer engages with the session within the TTL window", () => {
    vi.useFakeTimers();
    try {
      const fa = makeFakeAgent();
      const runtime = createAcpRuntime({
        spawnAgent: () => fa.agent,
        workingDir: "/tmp",
        orphanTtlMs: 100,
      });

      const c1 = makeFakeChannel();
      runtime.attach(c1.channel);
      c1.pushMessage(resumeSessionRequest(1));
      fa.pushLine(permissionRequest(7));
      c1.remoteClose();

      vi.advanceTimersByTime(50);
      const c2 = makeFakeChannel();
      runtime.attach(c2.channel);
      c2.pushMessage(resumeSessionRequest(1));

      vi.advanceTimersByTime(200);
      expect(fa.sent.some((f) => (f as { error?: unknown }).error)).toBe(false);
      expect(runtime.status().pendingRequestCount).toBe(1);
      expect(c2.sent).toContain(permissionRequest(7));
    } finally {
      vi.useRealTimers();
    }
  });

  it("a channel that only calls listSessions never engages and cannot consume a pending request", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const viewer = makeFakeChannel();
    runtime.attach(viewer.channel);
    viewer.pushMessage(resumeSessionRequest(1));
    fa.pushLine(permissionRequest(3));
    expect(viewer.sent).toContain(permissionRequest(3));
    expect(runtime.status().pendingRequestCount).toBe(1);

    // An operational call arrives on a separate channel — list sessions and go.
    const ops = makeFakeChannel();
    runtime.attach(ops.channel);
    ops.pushMessage(listSessionsRequest(1));

    // listSessions client did not receive the permission prompt.
    expect(ops.sent.some((f) => f === permissionRequest(3))).toBe(false);

    // Even if it naively responded with a bogus outcome using the pending id,
    // we'd still keep the pending (it didn't engage, so nothing was replayed);
    // the "answer" would be a response from a channel that never asked. Verify
    // the pending is still there and the agent hasn't been notified.
    const before = fa.sent.length;
    ops.remoteClose();
    expect(runtime.status().pendingRequestCount).toBe(1);
    expect(fa.sent).toHaveLength(before);
  });

  it("broadcasts a platform/turnEnded notification to engaged channels when a prompt completes", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(promptRequest(1));
    // c2 is engaged with SID (not via prompt, but would be via resume in a
    // real viewer). Engage explicitly.
    c2.pushMessage(resumeSessionRequest(2));

    const outbound = outboundId(fa.sent[0]);
    fa.pushLine(agentPromptResponse(outbound));

    // Both engaged channels see the turn-ended notification.
    const turnEnded = (sent: string[]) => sent.find((f) => {
      try { return JSON.parse(f).method === "platform/turnEnded"; } catch { return false; }
    });
    expect(turnEnded(c1.sent)).toBeDefined();
    expect(turnEnded(c2.sent)).toBeDefined();
  });

  it("does not broadcast platform/turnEnded to channels not engaged with the session", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(promptRequest(1));
    // c2 only runs listSessions and never engages with a session.
    c2.pushMessage(listSessionsRequest(2));

    const outbound = outboundId(fa.sent[0]);
    fa.pushLine(agentPromptResponse(outbound));

    const turnEnded = c2.sent.find((f) => {
      try { return JSON.parse(f).method === "platform/turnEnded"; } catch { return false; }
    });
    expect(turnEnded).toBeUndefined();
  });

  it("shutdown closes every attached channel and kills the agent", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    runtime.shutdown();
    expect(c1.isOpen()).toBe(false);
    expect(c2.isOpen()).toBe(false);
    expect(fa.killed()).toBe(true);
  });

  it("closes the SDK session after a turn ends with no engaged channels", () => {
    // Scheduled trigger scenario: a prompt fires and completes with nobody
    // watching the session. The claude subprocess the SDK spawned should be
    // reaped via `session/close` to avoid unbounded memory growth.
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);

    // Open a session and send a prompt.
    c.pushMessage(newSessionRequest(1));
    const sessOut = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sessOut));
    c.pushMessage(promptRequest(2));
    const promptOut = outboundId(fa.sent[1]);

    // Viewer disconnects before the response arrives.
    c.remoteClose();
    expect(fa.sent.filter((f: any) => f.method === "session/close")).toHaveLength(0);

    // Turn ends — nobody's watching, nothing pending → close.
    fa.pushLine(agentPromptResponse(promptOut));
    const closeFrames = fa.sent.filter((f: any) => f.method === "session/close");
    expect(closeFrames).toHaveLength(1);
    expect((closeFrames[0] as any).params).toEqual({ sessionId: SID });
  });

  it("does not close the session while a viewer is still engaged", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(newSessionRequest(1));
    const sessOut = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sessOut));
    c.pushMessage(promptRequest(2));
    const promptOut = outboundId(fa.sent[1]);
    fa.pushLine(agentPromptResponse(promptOut));

    expect(fa.sent.filter((f: any) => f.method === "session/close")).toHaveLength(0);
  });

  it("closes the SDK session when the last engaged channel detaches", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(newSessionRequest(1));
    const sessOut = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sessOut));
    // Session is idle (no prompt in flight). Viewer leaves → reap.
    c.remoteClose();

    const closeFrames = fa.sent.filter((f: any) => f.method === "session/close");
    expect(closeFrames).toHaveLength(1);
    expect((closeFrames[0] as any).params).toEqual({ sessionId: SID });
  });

  it("does not send session/close when the agent didn't advertise the capability", () => {
    // pi-acp scenario: the harness implements ACP but doesn't support
    // `session/close`. The runtime must respect the absence of
    // `agentCapabilities.sessionCapabilities.close` from the initialize
    // response and skip the reap call — sending it would error / kill the
    // agent. The local log stays around so a future session/resume can serve
    // from cache without forcing a cold rebuild the agent can't satisfy.
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);

    // Client initializes; agent advertises *no* `close` capability.
    c.pushMessage(initializeRequest(0));
    const initOut = outboundId(fa.sent[0]);
    fa.pushLine(initializeResponse(initOut, { fork: {}, list: {}, resume: {} }));

    c.pushMessage(newSessionRequest(1));
    const sessOut = outboundId(fa.sent[1]);
    fa.pushLine(newSessionResponse(sessOut));
    c.remoteClose();

    expect(fa.sent.filter((f: any) => f.method === "session/close")).toHaveLength(0);
  });

  it("does not send session/close when the agent's initialize omits sessionCapabilities entirely", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);

    c.pushMessage(initializeRequest(0));
    const initOut = outboundId(fa.sent[0]);
    fa.pushLine(initializeResponse(initOut, undefined));

    c.pushMessage(newSessionRequest(1));
    const sessOut = outboundId(fa.sent[1]);
    fa.pushLine(newSessionResponse(sessOut));
    c.remoteClose();

    expect(fa.sent.filter((f: any) => f.method === "session/close")).toHaveLength(0);
  });

  it("does send session/close when the agent advertises sessionCapabilities.close", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);

    c.pushMessage(initializeRequest(0));
    const initOut = outboundId(fa.sent[0]);
    fa.pushLine(initializeResponse(initOut, { close: {} }));

    c.pushMessage(newSessionRequest(1));
    const sessOut = outboundId(fa.sent[1]);
    fa.pushLine(newSessionResponse(sessOut));
    c.remoteClose();

    const closeFrames = fa.sent.filter((f: any) => f.method === "session/close");
    expect(closeFrames).toHaveLength(1);
    expect((closeFrames[0] as any).params).toEqual({ sessionId: SID });
  });

  it("does not close a session with pending permission requests", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(newSessionRequest(1));
    const sessOut = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sessOut));

    // Agent asks for permission. Viewer closes before answering.
    fa.pushLine(permissionRequest(7));
    c.remoteClose();

    // Session has a pending request — must stay open for whoever answers
    // next (reconnect, another viewer). The 10-min orphan TTL will reject
    // the request if nobody comes back.
    expect(fa.sent.filter((f: any) => f.method === "session/close")).toHaveLength(0);
  });

  it("serves subsequent session/load from the in-memory log instead of forwarding to the agent", () => {
    // Viewer A cold-bootstraps the session: forwards session/load to the
    // agent, receives history + response, engages live. Viewer B opens a
    // second tab and issues session/load for the same sid. With the log
    // already populated, the runtime synthesises the response from cached
    // metadata and replays the log to B directly — no second agent round-
    // trip, and A doesn't see anything because the log isn't fanning out
    // to cursors that are already at the tail.
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const a = makeFakeChannel();
    runtime.attach(a.channel);

    a.pushMessage(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "session/load", params: { sessionId: SID, cwd: "." },
    }));
    const aLoadOut = outboundId(fa.sent[0]);
    fa.pushLine(sessionUpdate(SID));
    fa.pushLine(JSON.stringify({ jsonrpc: "2.0", id: aLoadOut, result: { sessionId: SID, modes: {}, models: {}, configOptions: [] } }));

    const aBefore = a.sent.length;
    const agentSentBefore = fa.sent.length;

    // Viewer B joins and loads — should be served from memory.
    const b = makeFakeChannel();
    runtime.attach(b.channel);
    b.pushMessage(JSON.stringify({
      jsonrpc: "2.0", id: 42, method: "session/load", params: { sessionId: SID, cwd: "." },
    }));

    // Runtime did not forward to the agent.
    expect(fa.sent.length).toBe(agentSentBefore);
    // B got the history (session/update) and the synthetic response.
    expect(b.sent.some((f) => JSON.parse(f).method === "session/update")).toBe(true);
    expect(b.sent.some((f) => JSON.parse(f).id === 42)).toBe(true);
    // A did not receive anything new — its cursor was already at the tail.
    expect(a.sent.length).toBe(aBefore);
  });

  it("session/resume hot path: serves from cached metadata without forwarding to the agent", () => {
    // When a prior session/load (or session/new / session/fork) populated
    // log.metadata, a subsequent session/resume must be served entirely
    // from the runtime — never forwarded. This makes resume agent-agnostic
    // (works for harnesses like pi-acp that don't implement
    // unstable_resumeSession at all) and avoids a needless agent roundtrip.
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    // Tab A creates the session, populating log.metadata.
    const a = makeFakeChannel();
    runtime.attach(a.channel);
    a.pushMessage(newSessionRequest(1));
    const newOut = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(newOut, SID));

    const agentSentBefore = fa.sent.length;

    // Tab B opens a fresh channel and resumes. With cached metadata, this
    // is the hot path: synthetic response, no agent forward.
    const b = makeFakeChannel();
    runtime.attach(b.channel);
    b.pushMessage(resumeSessionRequest(7));

    expect(fa.sent.length).toBe(agentSentBefore);
    const resumeResp = b.sent.map((f) => JSON.parse(f)).find((p) => p.id === 7);
    expect(resumeResp).toBeDefined();
    expect(resumeResp.result).toBeDefined();

    // B is engaged — a subsequent live update fans out to it.
    const live = JSON.stringify({
      method: "session/update",
      params: { sessionId: SID, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "live" } } },
    });
    fa.pushLine(live);
    expect(b.sent.some((f) => f === live)).toBe(true);
  });

  it("session/resume hot path: does not replay history to the resuming channel", () => {
    // Resume's contract is "rebind for future events" — unlike load, it
    // must not stream catch-up. The UI runs a throwaway session/load
    // first to project history into React state; the live channel's
    // resume should only deliver live events from that point on.
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    // Tab A populates the log via session/new + a streamed update.
    const a = makeFakeChannel();
    runtime.attach(a.channel);
    a.pushMessage(newSessionRequest(1));
    fa.pushLine(newSessionResponse(outboundId(fa.sent[0]), SID));
    const histEvent = JSON.stringify({
      method: "session/update",
      params: { sessionId: SID, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "history" } } },
    });
    fa.pushLine(histEvent);
    expect(a.sent.some((f) => f === histEvent)).toBe(true);

    // Tab B resumes. The historical entry must NOT be replayed to B.
    const b = makeFakeChannel();
    runtime.attach(b.channel);
    b.pushMessage(resumeSessionRequest(42));

    expect(b.sent.some((f) => f === histEvent)).toBe(false);
  });

  it("session/resume cold path: runtime issues an internal session/load and serves the resume waiter when it completes", () => {
    // Cold resume — no cached metadata for the sid. The runtime cannot
    // forward session/resume to the agent (pi-acp et al. don't implement
    // it; even harnesses that do can't resume against a freshly-respawned
    // subprocess). Instead the runtime issues its own session/load and,
    // on completion, serves the parked resume waiter via engage + synthetic
    // resume response (no replay to the channel).
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const a = makeFakeChannel();
    runtime.attach(a.channel);
    a.pushMessage(resumeSessionRequest(1));

    // Runtime forwarded session/load (not session/resume) to the agent.
    expect(fa.sent.length).toBe(1);
    expect((fa.sent[0] as any).method).toBe("session/load");
    expect((fa.sent[0] as any).params.sessionId).toBe(SID);

    // Agent replays history during the bootstrap window — these events
    // populate the log but must NOT reach A (it has history in React
    // state from a prior throwaway loadSession).
    const replay = JSON.stringify({
      method: "session/update",
      params: { sessionId: SID, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "old" } } },
    });
    fa.pushLine(replay);
    expect(a.sent.some((f) => f === replay)).toBe(false);

    // Load response → bootstrap completes → runtime synthesizes a resume
    // response for A.
    completeResumeBootstrap(fa, SID);
    const resumeResp = a.sent.map((f) => JSON.parse(f)).find((p) => p.id === 1);
    expect(resumeResp).toBeDefined();
    expect(resumeResp.result).toBeDefined();

    // Subsequent resume from a fresh channel hits the hot path — no
    // additional agent forward.
    const agentSentBefore = fa.sent.length;
    const b = makeFakeChannel();
    runtime.attach(b.channel);
    b.pushMessage(resumeSessionRequest(99));
    expect(fa.sent.length).toBe(agentSentBefore);
    expect(b.sent.some((f) => JSON.parse(f).id === 99)).toBe(true);
  });

  it("session/resume cold path: concurrent resumes coalesce onto one bootstrap", () => {
    // Two cold resumes for the same sid arrive before metadata exists.
    // The second must pile onto the in-flight bootstrap as a waiter
    // rather than triggering a second agent forward.
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const a = makeFakeChannel();
    const b = makeFakeChannel();
    runtime.attach(a.channel);
    runtime.attach(b.channel);
    a.pushMessage(resumeSessionRequest(1));
    b.pushMessage(resumeSessionRequest(2));

    const loads = fa.sent.filter((f: any) => f.method === "session/load");
    expect(loads.length).toBe(1);

    // One load response serves both waiters.
    completeResumeBootstrap(fa, SID);
    expect(a.sent.some((f) => JSON.parse(f).id === 1)).toBe(true);
    expect(b.sent.some((f) => JSON.parse(f).id === 2)).toBe(true);
  });

  it("session/resume cold path: mixed resume + load waiters are each served by their kind", () => {
    // A cold resume kicks off a runtime-initiated load. Before it
    // completes, a second tab issues a real session/load for the same
    // sid → it parks as a load waiter on the same bootstrap. On
    // completion, the resume waiter gets engagement + a synthetic resume
    // response (no replay), while the load waiter gets full catch-up +
    // a load response (replay included).
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const a = makeFakeChannel();
    const b = makeFakeChannel();
    runtime.attach(a.channel);
    runtime.attach(b.channel);
    a.pushMessage(resumeSessionRequest(1));

    const replay = JSON.stringify({
      method: "session/update",
      params: { sessionId: SID, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hist" } } },
    });
    fa.pushLine(replay);

    b.pushMessage(JSON.stringify({
      jsonrpc: "2.0", id: 42, method: "session/load", params: { sessionId: SID, cwd: "." },
    }));

    // Only one forward to the agent — B coalesced onto A's bootstrap.
    const loadForwards = fa.sent.filter((f: any) => f.method === "session/load");
    expect(loadForwards.length).toBe(1);

    completeResumeBootstrap(fa, SID);

    // A (resume waiter) does NOT receive the replay event.
    expect(a.sent.some((f) => f === replay)).toBe(false);
    // B (load waiter) DOES — it asked for full history.
    expect(b.sent.some((f) => f === replay)).toBe(true);

    // Both got their respective responses.
    expect(a.sent.some((f) => JSON.parse(f).id === 1)).toBe(true);
    expect(b.sent.some((f) => JSON.parse(f).id === 42)).toBe(true);
  });

  it("caches session/new response metadata so a later session/load is served from memory (no re-replay)", () => {
    // Regression: when a session is created via session/new and populated
    // by live prompt events, the runtime used to leave log.metadata=null
    // because metadata caching only fired on session/load responses. A
    // second viewer's session/load would then miss the cache, cold-
    // bootstrap the agent, and the agent's replaySessionHistory would
    // append the same history AGAIN — duplicating every entry in the log
    // and fanning the duplicates out to the originator (whose cursor
    // was at the tail of the first copy).
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    // Tab A creates a new session and sends a prompt.
    const a = makeFakeChannel();
    runtime.attach(a.channel);
    a.pushMessage(newSessionRequest(1));
    const newOut = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(newOut, SID));

    a.pushMessage(promptRequest(2));
    const promptOut = outboundId(fa.sent[1]);
    fa.pushLine(JSON.stringify({
      method: "session/update",
      params: { sessionId: SID, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi from A" } } },
    }));
    fa.pushLine(agentPromptResponse(promptOut));

    const aBefore = a.sent.length;
    const agentSentBefore = fa.sent.length;

    // Tab B opens and loads the same session. Should be served from the
    // runtime's in-memory log — no forward to the agent, no duplicate
    // history events appended.
    const b = makeFakeChannel();
    runtime.attach(b.channel);
    b.pushMessage(JSON.stringify({
      jsonrpc: "2.0", id: 42, method: "session/load", params: { sessionId: SID, cwd: "." },
    }));

    // No additional forward to the agent.
    expect(fa.sent.length).toBe(agentSentBefore);
    // B got the history + synthetic response.
    expect(b.sent.some((f) => JSON.parse(f).method === "session/update")).toBe(true);
    expect(b.sent.some((f) => JSON.parse(f).id === 42)).toBe(true);
    // A did not receive any extra events — its cursor was at the tail.
    expect(a.sent.length).toBe(aBefore);
  });

  it("synthesizes user_message_chunk from session/prompt and fans it out to non-sender viewers", () => {
    // Claude Agent SDK drops plain-text user_message_chunk emissions in
    // live (see acp-agent.js: "Skip these user messages for now..."), so a
    // non-originating viewer would never see the user's message. The
    // runtime synthesizes it from the session/prompt payload and appends
    // it to the log, fanning out to every engaged channel EXCEPT the
    // sender (which already rendered an optimistic bubble). On reconnect
    // the sender still gets it via catch-up from the log.
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const a = makeFakeChannel();
    const b = makeFakeChannel();
    runtime.attach(a.channel);
    runtime.attach(b.channel);
    a.pushMessage(resumeSessionRequest(1));
    b.pushMessage(resumeSessionRequest(1));

    a.pushMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "session/prompt",
      params: { sessionId: SID, prompt: [{ type: "text", text: "hello from A" }] },
    }));

    const echoes = (ch: ReturnType<typeof makeFakeChannel>) =>
      ch.sent.filter((f) => {
        try {
          const p = JSON.parse(f);
          return p.method === "session/update"
            && p.params?.update?.sessionUpdate === "user_message_chunk"
            && p.params?.update?.content?.text === "hello from A";
        } catch { return false; }
      });

    // Sender skipped, other viewer receives.
    expect(echoes(a).length).toBe(0);
    expect(echoes(b).length).toBe(1);
  });

  it("delivers a skipped echo to the same user's new channel via catch-up", () => {
    // Sender sends a prompt, then reconnects (old channel closes, new one
    // opens). The new channel has cursor=0 and a fresh session/load catch-
    // up should stream the synthesized user_message_chunk to it, so the
    // user doesn't lose their own message on reload.
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const a = makeFakeChannel();
    runtime.attach(a.channel);
    // Cold-load the session to give the log cached metadata.
    a.pushMessage(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "session/load", params: { sessionId: SID, cwd: "." },
    }));
    const loadOut = outboundId(fa.sent[0]);
    fa.pushLine(JSON.stringify({ jsonrpc: "2.0", id: loadOut, result: { sessionId: SID, modes: {}, models: {}, configOptions: [] } }));

    a.pushMessage(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "session/prompt",
      params: { sessionId: SID, prompt: [{ type: "text", text: "my message" }] },
    }));
    a.remoteClose();

    // Reconnect as a fresh channel.
    const a2 = makeFakeChannel();
    runtime.attach(a2.channel);
    a2.pushMessage(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "session/load", params: { sessionId: SID, cwd: "." },
    }));

    const echo = a2.sent.find((f) => {
      try {
        const p = JSON.parse(f);
        return p.params?.update?.sessionUpdate === "user_message_chunk"
          && p.params?.update?.content?.text === "my message";
      } catch { return false; }
    });
    expect(echo).toBeDefined();
  });

  it("fans out live session/update to engaged channels via per-channel cursors", () => {
    // With the log model, a live notification gets appended and fanned out
    // to every engaged channel whose cursor is behind. Cursors advance so a
    // channel cannot receive the same line twice.
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const a = makeFakeChannel();
    const b = makeFakeChannel();
    runtime.attach(a.channel);
    runtime.attach(b.channel);
    a.pushMessage(resumeSessionRequest(1));
    b.pushMessage(resumeSessionRequest(1));
    // Two cold resumes for the same sid coalesce onto one runtime-initiated
    // session/load — a single response completes both bootstraps.
    completeResumeBootstrap(fa, SID);

    const liveChunk = JSON.stringify({
      method: "session/update",
      params: { sessionId: SID, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } } },
    });
    fa.pushLine(liveChunk);

    expect(a.sent.filter((f) => f === liveChunk).length).toBe(1);
    expect(b.sent.filter((f) => f === liveChunk).length).toBe(1);
  });

  it("coalesces concurrent cold-bootstrap loads: only one forward, both served", () => {
    // Two viewers open brand-new tabs and hit session/load at the same
    // time. Without coalescing, both requests would forward to the agent
    // and the history would be appended to the log twice. The runtime
    // parks the second load as a waiter on the in-flight bootstrap and
    // serves it from the populated log once the first response arrives.
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const a = makeFakeChannel();
    const b = makeFakeChannel();
    runtime.attach(a.channel);
    runtime.attach(b.channel);

    a.pushMessage(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "session/load", params: { sessionId: SID, cwd: "." },
    }));
    // Snapshot: only one forward to the agent at this point.
    const forwardsAfterA = fa.sent.filter((f: any) => f.method === "session/load").length;

    // B's load arrives while A's bootstrap is still in flight.
    b.pushMessage(JSON.stringify({
      jsonrpc: "2.0", id: 99, method: "session/load", params: { sessionId: SID, cwd: "." },
    }));

    // No second forward — B is parked as a waiter.
    expect(fa.sent.filter((f: any) => f.method === "session/load").length).toBe(forwardsAfterA);

    // Agent replies to A's load with history + response.
    const aLoadOut = outboundId(fa.sent.filter((f: any) => f.method === "session/load")[0]);
    fa.pushLine(sessionUpdate(SID));
    fa.pushLine(JSON.stringify({ jsonrpc: "2.0", id: aLoadOut, result: { sessionId: SID, modes: {}, models: {}, configOptions: [] } }));

    // Both A and B received the history and their own response ids.
    expect(a.sent.some((f) => JSON.parse(f).id === 1)).toBe(true);
    expect(b.sent.some((f) => JSON.parse(f).id === 99)).toBe(true);
    expect(a.sent.some((f) => JSON.parse(f).method === "session/update")).toBe(true);
    expect(b.sent.some((f) => JSON.parse(f).method === "session/update")).toBe(true);
  });

  it("does not replay an answered permission request on a fresh session/load", () => {
    // Regression: permission prompts are agent→client JSON-RPC requests.
    // If the runtime logged them into the session log, catchUp would ship
    // the frame again when a new viewer (or the same viewer in a new tab)
    // loads the session — the client's requestPermission handler would
    // fire a second time and re-open the dialog the user already answered.
    // Fix: agent requests are live-only, tracked in pendingFromAgent and
    // redelivered by engage(); never in the log.
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const a = makeFakeChannel();
    runtime.attach(a.channel);
    a.pushMessage(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "session/load", params: { sessionId: SID, cwd: "." },
    }));
    const aLoadOut = outboundId(fa.sent[0]);
    fa.pushLine(JSON.stringify({ jsonrpc: "2.0", id: aLoadOut, result: { sessionId: SID, modes: {}, models: {}, configOptions: [] } }));

    // Agent asks for permission; A receives and answers it.
    fa.pushLine(permissionRequest(7));
    expect(a.sent.some((f) => f === permissionRequest(7))).toBe(true);
    a.pushMessage(permissionResponse(7));
    expect(runtime.status().pendingRequestCount).toBe(0);

    // Fresh viewer B loads the same session. Served from cached metadata.
    const b = makeFakeChannel();
    runtime.attach(b.channel);
    b.pushMessage(JSON.stringify({
      jsonrpc: "2.0", id: 42, method: "session/load", params: { sessionId: SID, cwd: "." },
    }));

    // B must not receive the answered permission request — the log has no
    // entry for it, and engage() finds pendingFromAgent empty.
    const gotPermission = b.sent.some((f) => {
      try { return JSON.parse(f).method === "session/request_permission"; }
      catch { return false; }
    });
    expect(gotPermission).toBe(false);
  });

  it("prepends a <clipped-conversation> sentinel when the log has been truncated", () => {
    // Tiny log cap forces eviction on the second entry. A fresh loader's
    // catch-up prepends a synthetic `platform_clipped_replay` notification so
    // the UI can render a "older messages not loaded" placeholder.
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp", logBytesCap: 10 });

    const a = makeFakeChannel();
    runtime.attach(a.channel);
    a.pushMessage(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "session/load", params: { sessionId: SID, cwd: "." },
    }));
    const aLoadOut = outboundId(fa.sent[0]);

    // Two large-ish updates to trigger eviction.
    const big1 = JSON.stringify({ method: "session/update", params: { sessionId: SID, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "aaaaaaaaaaaaaaa" } } } });
    const big2 = JSON.stringify({ method: "session/update", params: { sessionId: SID, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "bbbbbbbbbbbbbbb" } } } });
    fa.pushLine(big1);
    fa.pushLine(big2);
    fa.pushLine(JSON.stringify({ jsonrpc: "2.0", id: aLoadOut, result: { sessionId: SID } }));

    // B loads — catch-up should prepend the sentinel.
    const b = makeFakeChannel();
    runtime.attach(b.channel);
    b.pushMessage(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "session/load", params: { sessionId: SID, cwd: "." },
    }));

    const sentinel = b.sent.find((f) => {
      try { return JSON.parse(f).params?.update?.sessionUpdate === "platform_clipped_replay"; }
      catch { return false; }
    });
    expect(sentinel).toBeDefined();
  });

  it("does not close a session while a queued prompt is waiting", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    // Two engaged channels: c1 sends the active prompt, c2 queues one.
    // When c1 detaches its active prompt stays (we null its channel) but
    // c2's queued prompt is still waiting, so when the active prompt's
    // response comes back, advanceQueue promotes c2's. Session stays busy
    // and must not be closed.
    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(newSessionRequest(1));
    const sessOut = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sessOut));
    // Engage c2 with the same session via a prompt (forward engages it).
    c2.pushMessage(promptRequest(10));  // c2 is first — its prompt is active
    const firstOut = outboundId(fa.sent[1]);
    c1.pushMessage(promptRequest(11));  // c1's prompt gets queued

    // c2 leaves. Its active prompt's channel is nulled (still active slot).
    c2.remoteClose();
    fa.pushLine(agentPromptResponse(firstOut));

    // c1's queued prompt was promoted; session is busy, not idle.
    expect(fa.sent.filter((f: any) => f.method === "session/close")).toHaveLength(0);
  });
});
