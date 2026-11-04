// TEST_OVERVIEW: the runtime follows a session default without asking the api-server, so the `session-defaults` event it keeps is a run boundary: it carries the settings a following session takes at its next turn, the native subagent keys derived from each default's platform slot. A default that changes from B to C reaches a following session as C (D193B).
import { describe, expect, it } from "vitest";
import type { HarnessCapability } from "agent-runtime-api";
import type { SessionPair, SessionDefaultsView } from "api-server-api";
import type { ResolvedProfile } from "../../modules/profiles/index.js";
import type { Db } from "db";
import {
  createRunBoundary,
  runSubagentSettings,
} from "../../modules/harness-config/index.js";
import { createSessionDefaultsPublisher } from "../../modules/harness-config/services/session-defaults-publisher.js";
import { sessionDefaultsEvent } from "../../modules/harness-config/domain/session-defaults-event.js";
import {
  createSessionPairRepo,
  type SessionPairRepo,
} from "../../modules/harness-config/infrastructure/session-pair-repo.js";

/* UNIT_BOUNDARY_DESCRIPTION: Claude Code's real capability and the owner's listing for the default's Connection (D193B). */
const CLAUDE: HarnessCapability = {
  name: "claude-code",
  harnessConfig: true,
  sessionModel: true,
  sessionSettings: ["subagentModel"],
  harnessConfigCatalog: {
    options: [
      {
        id: "subagentModel",
        name: "Subagent model",
        category: "model",
        subagents: true,
        choices: [],
      },
    ],
  },
};
const catalog = {
  providers: [
    {
      connectionId: "conn-1",
      models: [
        { name: "anthropic/claude-haiku-5", harnesses: ["claude-code"] },
        { name: "anthropic/claude-sonnet-5", harnesses: ["claude-code"] },
      ],
    },
  ],
} as unknown as Parameters<typeof runSubagentSettings>[1];

const pairOf = (model: string): SessionPair => ({
  harness: "claude-code",
  provider: "conn-1",
  model: "anthropic/claude-opus-5",
  settings: {
    "platformSubagent.harness": "claude-code",
    "platformSubagent.model": model,
  },
});

function publisher(saved: () => SessionDefaultsView) {
  const events: { id: string; payload: unknown }[] = [];
  const tx = { execute: async () => [{ at: "0" }] };
  const db = {
    transaction: async (work: (tx: unknown) => Promise<void>) => work(tx),
  } as unknown as Db;
  const publish = createSessionDefaultsPublisher({
    db,
    pairRepo: {
      readSaved: async () => saved(),
    } as unknown as SessionPairRepo,
    runtimeMutator: {
      supersede: async () => {},
      bump: async (
        _agentId: string,
        sent: { id: string; payload: unknown }[],
      ) => {
        events.push(...sent);
        return sent.length;
      },
      enqueueAfterCommit: async () => {},
    } as never,
    boundary: createRunBoundary({
      inputsOf: async () => ({
        capabilities: { harnesses: [CLAUDE] },
        catalog,
      }),
    }),
    now: () => 1000,
  });
  return { publish, events };
}

const defaultsOf = (chat: SessionPair | null): SessionDefaultsView => ({
  chat,
  channel: null,
  scheduled: null,
  chatProfileId: null,
});

describe("the session-defaults event", () => {
  // TEST_SCENARIO: a chat default whose platform sub-agent names B is taken by a following session at its next turn, so the event carries B derived into the native subagent model; an unsaved channel and scheduled default follow the chat one, settled the same way (D193B).
  it("carries the native subagent settings a following session takes", async () => {
    const { publish, events } = publisher(() =>
      defaultsOf(pairOf("anthropic/claude-haiku-5")),
    );
    await publish("agent-1");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      chat: {
        model: "anthropic/claude-opus-5",
        settings: {
          "platformSubagent.harness": "claude-code",
          "platformSubagent.model": "anthropic/claude-haiku-5",
          subagentModel: "anthropic/claude-haiku-5",
        },
      },
    });
    const payload = events[0]?.payload as Record<string, SessionPair>;
    expect(payload.channel?.settings).toMatchObject({
      subagentModel: "anthropic/claude-haiku-5",
    });
    expect(payload.scheduled?.settings).toMatchObject({
      subagentModel: "anthropic/claude-haiku-5",
    });
  });

  // TEST_SCENARIO: the default is edited from B to C while a session follows it; the next event replaces the last, so that session's next turn takes C, derived the same way (D193B).
  it("carries the edited default's sub-agent to a following session", async () => {
    let saved = pairOf("anthropic/claude-haiku-5");
    const { publish, events } = publisher(() => defaultsOf(saved));
    await publish("agent-1");
    saved = pairOf("anthropic/claude-sonnet-5");
    await publish("agent-1");
    const payload = events[1]?.payload as Record<string, SessionPair>;
    expect(payload.chat?.settings).toEqual({
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": "anthropic/claude-sonnet-5",
      subagentModel: "anthropic/claude-sonnet-5",
    });
    expect(
      sessionDefaultsEvent(
        "agent-1",
        { chat: null, channel: null, scheduled: null },
        5,
      ).id,
    ).toBe("session-defaults:agent-1:5");
  });
});

describe("the defaults event beside a transaction that holds the pool", () => {
  /* UNIT_BOUNDARY_DESCRIPTION: a database whose global pool is unusable while a transaction holds its connection, as a pool of one is (D193B). */
  function poolOfOne(row: Record<string, unknown>) {
    const held = { open: false };
    const rows = <T>(of: readonly T[]): T[] =>
      Object.assign([...of], { for: () => rows(of) }) as T[];
    const select = () => ({
      from: () => ({
        where: () => rows([row]),
      }),
    });
    const tx = {
      select,
      execute: async () => [{ at: "0" }],
    };
    const db = {
      transaction: async (work: (tx: unknown) => Promise<void>) => {
        held.open = true;
        try {
          return await work(tx);
        } finally {
          held.open = false;
        }
      },
      select: () => {
        if (held.open)
          throw new Error("a global-pool read while the transaction holds it");
        return select();
      },
    } as unknown as Db;
    return { db, tx, held };
  }

  // TEST_SCENARIO: publication reads the agent's row and enqueues inside one transaction, while the owner catalog is listed before it opens: with the pool exhausted to one connection, a catalog or capability read inside the transaction would deadlock, and a profile the row names resolves through that transaction's own connection instead of the global pool (D193B).
  it("publishes without a global-pool read inside the transaction", async () => {
    const row = {
      chat: pairOf("anthropic/claude-haiku-5"),
      channel: null,
      scheduled: null,
      sessionProfile: "profile-1",
      platformSubagentProfile: null,
      platformSubagentSettings: null,
      capabilities: { harnesses: [CLAUDE] },
    };
    const { db, tx, held } = poolOfOne(row);
    const events: { payload: unknown }[] = [];
    const resolversSeen: unknown[] = [];
    const inputsSeen: boolean[] = [];
    const publish = createSessionDefaultsPublisher({
      db,
      pairRepo: createSessionPairRepo(
        db,
        async () => null,
        (executor) => {
          resolversSeen.push(executor);
          const resolved = {
            profile: { name: "P" },
            pair: pairOf("anthropic/claude-haiku-5"),
            unavailable: null,
            subagent: pairOf("anthropic/claude-haiku-5").settings,
            subagentUnavailable: null,
            attachable: false,
          } as unknown as ResolvedProfile;
          return async () => resolved;
        },
      ),
      runtimeMutator: {
        supersede: async () => {},
        bump: async (_agentId: string, sent: { payload: unknown }[]) => {
          events.push(...sent);
          return sent.length;
        },
        enqueueAfterCommit: async () => {},
      } as never,
      boundary: createRunBoundary({
        inputsOf: async () => {
          inputsSeen.push(held.open);
          return { capabilities: { harnesses: [CLAUDE] }, catalog };
        },
      }),
      now: () => 1000,
    });
    await publish("agent-1");
    expect(inputsSeen).toEqual([false]);
    expect(resolversSeen).toEqual([tx]);
    const payload = events[0]?.payload as Record<string, SessionPair>;
    expect(payload.chat?.settings).toMatchObject({
      "platformSubagent.model": "anthropic/claude-haiku-5",
      subagentModel: "anthropic/claude-haiku-5",
    });
  });
});
