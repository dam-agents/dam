import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { createTurnRunner } from "../../modules/hosted-harness/services/turn-runner.js";
import { AgentStoppedError } from "../../modules/agents/index.js";
import type {
  HostedSessionRow,
  HostedTurnRow,
  TurnLogRepository,
} from "../../modules/hosted-harness/infrastructure/turn-log-repository.js";
import type { TurnEvent } from "../../modules/hosted-harness/domain/events.js";
import type { HostedPodClient } from "../../modules/hosted-harness/infrastructure/pod-client.js";

// TEST_OVERVIEW: the hosted turn loop — event-sourced steps, tool execution against the pod, resume with dangling tool calls, and fence-conflict yield.

interface FakeStore {
  repo: TurnLogRepository;
  events: TurnEvent[];
  turn: HostedTurnRow;
}

function fakeStore(seedEvents: Partial<TurnEvent>[]): FakeStore {
  let nextId = 1;
  const events: TurnEvent[] = seedEvents.map((e) => ({
    id: nextId++,
    sessionId: "s1",
    turnId: "t1",
    seq: e.seq ?? 0,
    kind: e.kind ?? "user-message",
    payload: e.payload ?? {},
    createdAt: new Date(),
    ...e,
  }));
  const session: HostedSessionRow = {
    id: "s1",
    agentId: "agent-1",
    owner: "o1",
    title: null,
    mode: "chat",
    scheduleId: null,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const turn: HostedTurnRow = {
    id: "t1",
    sessionId: "s1",
    agentId: "agent-1",
    status: "running",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const repo: TurnLogRepository = {
    createSession: async () => {},
    getSession: async () => session,
    listSessions: async () => [session],
    setSessionMode: async () => {},
    setSessionTitle: async () => {},
    recordSeen: async () => {},
    deleteSession: async () => {},
    createTurn: async () => {},
    getTurn: async () => turn,
    heartbeatTurn: async () => {},
    endTurn: async (_id, status) => {
      turn.status = status;
    },
    listRunningTurnsStalledSince: async () => [],
    runningTurnForSession: async () => null,
    appendEvent: async (input) => {
      if (
        events.some((e) => e.turnId === input.turnId && e.seq === input.seq)
      ) {
        return "conflict";
      }
      events.push({
        id: nextId++,
        createdAt: new Date(),
        ...input,
      } as TurnEvent);
      return "ok";
    },
    listSessionEvents: async () => [...events],
    listTurnEvents: async (turnId) => events.filter((e) => e.turnId === turnId),
    latestSessionEventId: async () => events.at(-1)?.id ?? 0,
  };
  return { repo, events, turn };
}

function fakeModel(
  steps: Array<{
    text?: string;
    toolCalls?: Array<{ toolCallId: string; toolName: string; input: object }>;
    inputTokens?: number;
  }>,
): LanguageModel {
  let call = 0;
  return {
    specificationVersion: "v3",
    provider: "fake",
    modelId: "fake-model",
    supportedUrls: {},
    doGenerate: async () => {
      const step = steps[Math.min(call++, steps.length - 1)];
      const content = [
        ...(step.text ? [{ type: "text" as const, text: step.text }] : []),
        ...(step.toolCalls ?? []).map((c) => ({
          type: "tool-call" as const,
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          input: JSON.stringify(c.input),
        })),
      ];
      return {
        content,
        finishReason: (step.toolCalls?.length
          ? "tool-calls"
          : "stop") as "stop",
        usage: {
          inputTokens: {
            total: step.inputTokens ?? 10,
            noCache: step.inputTokens ?? 10,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
          totalTokens: (step.inputTokens ?? 10) + 5,
        },
        warnings: [],
      };
    },
    doStream: async () => {
      throw new Error("not used");
    },
  } as unknown as LanguageModel;
}

function fakePod(): HostedPodClient & { runs: string[] } {
  const runs: string[] = [];
  return {
    runs,
    execRun: async ({ command }) => {
      runs.push(command);
      return {
        exitCode: 0,
        output: "ran fine",
        truncated: false,
        timedOut: false,
        cwd: "/work",
      };
    },
    execStart: async () => ({ backgroundId: "bg1" }),
    execTail: async () => ({
      output: "",
      nextOffset: 0,
      running: true,
      exitCode: null,
    }),
    execKill: async () => ({ killed: true }),
    readFile: async () => ({ content: "file content" }),
    writeFile: async () => {},
    createFile: async () => {},
    listSkills: async () => [],
    readSkill: async () => ({ files: [] }),
  };
}

function runnerFor(store: FakeStore, model: LanguageModel) {
  const pod = fakePod();
  const ensurePodReady = vi.fn(async () => {});
  const runner = createTurnRunner({
    repo: store.repo,
    resolveModel: async () => ({ model, modelId: "fake-model" }),
    podClient: () => pod,
    getAgent: async () => ({ id: "agent-1", name: "test", workDir: "~/work" }),
    ensurePodReady,
    log: () => {},
  });
  return { runner, pod, ensurePodReady };
}

describe("hosted turn runner", () => {
  // TEST_SCENARIO: a Hard Stop mid-turn removes tools and the model writes one closing response before the turn ends interrupted
  it("closes gracefully when the pod wake is refused", async () => {
    const store = fakeStore([
      { kind: "user-message", payload: { text: "build it" }, seq: 0 },
    ]);
    const { runner, ensurePodReady } = runnerFor(
      store,
      fakeModel([
        {
          toolCalls: [
            { toolCallId: "c1", toolName: "bash", input: { command: "make" } },
          ],
        },
        { text: "I had to stop because the sandbox was stopped." },
      ]),
    );
    ensurePodReady.mockRejectedValue(new AgentStoppedError("agent-1"));
    await runner.runTurn("t1");
    expect(store.events.map((e) => e.kind)).toEqual([
      "user-message",
      "tool-call",
      "tool-result",
      "assistant-message",
      "turn-end",
    ]);
    expect(store.events.at(-1)?.payload).toMatchObject({
      status: "interrupted",
    });
    expect(store.turn.status).toBe("interrupted");
  });

  // TEST_SCENARIO: a text-only reply appends assistant-message + turn-end and never touches the pod (lazy wake)
  it("runs a tool-less turn without waking the pod", async () => {
    const store = fakeStore([
      { kind: "user-message", payload: { text: "hi" }, seq: 0 },
    ]);
    const { runner, ensurePodReady } = runnerFor(
      store,
      fakeModel([{ text: "hello!" }]),
    );
    await runner.runTurn("t1");
    expect(store.events.map((e) => e.kind)).toEqual([
      "user-message",
      "assistant-message",
      "turn-end",
    ]);
    expect(store.turn.status).toBe("done");
    expect(ensurePodReady).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a tool call wakes the pod, executes, and the loop continues to a final answer
  it("executes tool calls through the pod", async () => {
    const store = fakeStore([
      { kind: "user-message", payload: { text: "list files" }, seq: 0 },
    ]);
    const { runner, pod, ensurePodReady } = runnerFor(
      store,
      fakeModel([
        {
          toolCalls: [
            { toolCallId: "c1", toolName: "bash", input: { command: "ls" } },
          ],
        },
        { text: "done" },
      ]),
    );
    await runner.runTurn("t1");
    expect(pod.runs.some((c) => c.includes("ls"))).toBe(true);
    expect(ensurePodReady).toHaveBeenCalled();
    expect(store.events.map((e) => e.kind)).toEqual([
      "user-message",
      "tool-call",
      "tool-result",
      "assistant-message",
      "turn-end",
    ]);
  });

  // TEST_SCENARIO: resume — a dangling tool call from a dead replica gets a synthetic interrupted tool-result before the loop continues
  it("synthesizes results for dangling tool calls on resume", async () => {
    const store = fakeStore([
      { kind: "user-message", payload: { text: "go" }, seq: 0 },
      {
        kind: "tool-call",
        payload: { callId: "c9", tool: "bash", args: { command: "make" } },
        seq: 1,
      },
    ]);
    const { runner } = runnerFor(store, fakeModel([{ text: "recovered" }]));
    await runner.runTurn("t1");
    const kinds = store.events.map((e) => e.kind);
    expect(kinds).toEqual([
      "user-message",
      "tool-call",
      "tool-result",
      "assistant-message",
      "turn-end",
    ]);
    const synthetic = store.events[2];
    expect(synthetic.payload).toMatchObject({
      callId: "c9",
      interrupted: true,
      isError: true,
    });
  });

  // TEST_SCENARIO: reported input tokens past the threshold trigger a compaction event before the next LLM step, and the loop continues on the summary
  it("compacts context when the window fills", async () => {
    const store = fakeStore([
      { kind: "user-message", payload: { text: "long task" }, seq: 0 },
    ]);
    const { runner } = runnerFor(
      store,
      fakeModel([
        {
          toolCalls: [
            { toolCallId: "c1", toolName: "bash", input: { command: "ls" } },
          ],
          inputTokens: 200_000,
        },
        { text: "dense summary of everything so far" },
        { text: "done" },
      ]),
    );
    await runner.runTurn("t1");
    const kinds = store.events.map((e) => e.kind);
    expect(kinds).toContain("compaction");
    expect(kinds.at(-1)).toBe("turn-end");
    const compaction = store.events.find((e) => e.kind === "compaction");
    expect(compaction?.payload).toMatchObject({
      summary: "dense summary of everything so far",
    });
    expect(store.turn.status).toBe("done");
  });

  // TEST_SCENARIO: an append hitting the (turn_id, seq) fence yields without marking the turn failed — the other replica owns it
  it("yields on fence conflict", async () => {
    const store = fakeStore([
      { kind: "user-message", payload: { text: "hi" }, seq: 0 },
      { kind: "assistant-message", payload: { text: "taken" }, seq: 1 },
    ]);
    const originalList = store.repo.listSessionEvents;
    store.repo.listSessionEvents = async (sid) =>
      (await originalList(sid)).filter((e) => e.seq === 0);
    const originalTurnList = store.repo.listTurnEvents;
    store.repo.listTurnEvents = async (tid) =>
      (await originalTurnList(tid)).filter((e) => e.seq === 0);
    const { runner } = runnerFor(store, fakeModel([{ text: "mine" }]));
    await runner.runTurn("t1");
    expect(store.turn.status).toBe("running");
    expect(store.events.filter((e) => e.kind === "turn-end")).toHaveLength(0);
  });
});
