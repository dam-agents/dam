// TEST_OVERVIEW: Switching the assistant off for one person is the only thing that deletes an assistant, and it deletes only when the delete really happened. It runs under the owner's provisioning lock and re-checks there that the record is still the one the person's request read and that the install still lets a person opt out, so a stale request cannot delete an assistant someone has since opted back into. It touches nobody else, is a no-op for someone with no assistant, leaves the Agent that was renamed to free the reserved name alone, and reports failure — never a completed opt-out — when the lock is held.
import { describe, expect, it } from "vitest";
import type {
  AssistantRow,
  AssistantsRepository,
} from "../../modules/assistants/infrastructure/assistants-repository.js";
import { assistantAgentId } from "../../modules/assistants/domain/agent-id.js";
import { removeAssistant } from "../../modules/assistants/services/assistant-removal.js";

const ALICE = "alice";
const BOB = "bob";
const ASSISTANT = assistantAgentId(ALICE, 1);
const FRESH = assistantAgentId(ALICE, 2);

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

/** UNIT_BOUNDARY_DESCRIPTION: the assistants rows of two people and the Agents they name, so a removal can be shown to touch only the caller's. */
function world() {
  const rows = new Map<string, AssistantRow>([
    [
      ALICE,
      {
        owner: ALICE,
        incarnation: 1,
        agentId: ASSISTANT,
        state: "ready",
        steps: ["env", "egress", "instructions", "grants"],
        used: true,
        renamed: {
          agentId: "agent-old",
          from: "Dambledore",
          to: "Dambledore (yours)",
          done: true,
        },
        noticeSeen: false,
      },
    ],
    [
      BOB,
      {
        owner: BOB,
        incarnation: 1,
        agentId: assistantAgentId(BOB, 1),
        state: "ready",
        steps: [],
        used: false,
        renamed: null,
        noticeSeen: false,
      },
    ],
  ]);
  const agents = new Set([...rows.values()].map((r) => r.agentId));
  const deleted: string[] = [];
  const repo = unused<AssistantsRepository>({
    find: async (owner: string) => rows.get(owner) ?? null,
    forgetAll: async (
      owner: string,
      fromAgentId: string,
      toAgentId: string,
    ) => {
      const row = rows.get(owner);
      if (!row || row.agentId !== fromAgentId) return;
      rows.set(owner, {
        ...row,
        incarnation: row.incarnation + 1,
        agentId: toAgentId,
        state: "creating",
        steps: [],
        used: false,
        renamed: null,
        noticeSeen: false,
      });
    },
  });
  const lock = { held: new Set<string>() };
  const withLock = async <T>(owner: string, work: () => Promise<T>) => {
    if (lock.held.has(owner)) return { ran: false as const };
    lock.held.add(owner);
    try {
      return { ran: true as const, value: await work() };
    } finally {
      lock.held.delete(owner);
    }
  };
  const deleteAgent = async (id: string) => {
    if (!agents.has(id)) return;
    agents.delete(id);
    deleted.push(id);
  };
  const stored: { owner: string; at: string }[] = [];
  const removal = (
    owner: string,
    opts: {
      expectedAgentId?: string | null;
      optOutAllowed?: boolean;
      onRemoved?: () => Promise<void>;
    } = {},
  ) =>
    removeAssistant({
      repo,
      agents: { delete: deleteAgent } as never,
      withLock,
      owner,
      expectedAgentId:
        opts.expectedAgentId === undefined
          ? (rows.get(owner)?.agentId ?? null)
          : opts.expectedAgentId,
      optOutAllowed: async () => opts.optOutAllowed ?? true,
      onRemoved:
        opts.onRemoved ??
        (async () => {
          stored.push({ owner, at: "removed" });
        }),
      sleep: async () => undefined,
    } as unknown as Parameters<typeof removeAssistant>[0]);
  return { rows, agents, deleted, removal, lock, stored };
}

describe("switching the assistant off for one person", () => {
  // TEST_SCENARIO: the caller's assistant is deleted through the ordinary Agent delete, and their record is forgotten: the next incarnation's Agent id, nothing initialized, never used, and no rename news.
  it("deletes the caller's assistant and forgets its record", async () => {
    const w = world();
    expect(await w.removal(ALICE)).toEqual({ ran: true, value: true });

    expect(w.deleted).toEqual([ASSISTANT]);
    expect(w.rows.get(ALICE)).toMatchObject({
      incarnation: 2,
      agentId: FRESH,
      state: "creating",
      steps: [],
      used: false,
      renamed: null,
    });
    expect(w.stored).toEqual([{ owner: ALICE, at: "removed" }]);
  });

  // TEST_SCENARIO: nobody else's assistant is touched, and the Agent the record renamed to free the reserved name stays exactly as it was — a person's own Agent is never renamed back.
  it("leaves another person's assistant and the renamed Agent alone", async () => {
    const w = world();
    await w.removal(ALICE);
    expect(w.deleted).toEqual([ASSISTANT]);
    expect(w.rows.get(BOB)?.agentId).toBe(assistantAgentId(BOB, 1));
    expect(w.deleted).not.toContain("agent-old");
  });

  // TEST_SCENARIO: a person with no assistant is a no-op that still lets the switch go off.
  it("is a no-op for a person with no assistant", async () => {
    const w = world();
    expect(await w.removal("carol")).toEqual({ ran: true, value: true });
    expect(w.deleted).toEqual([]);
    expect(w.rows.has("carol")).toBe(false);
  });

  // TEST_SCENARIO: the lock held for the first attempts frees a moment later, so the delete is waited for rather than reported as done.
  it("waits for the lock and then deletes", async () => {
    const w = world();
    w.lock.held.add(ALICE);
    let waits = 0;
    const removal = removeAssistant({
      repo: unused<AssistantsRepository>({
        find: async (owner: string) => w.rows.get(owner) ?? null,
        forgetAll: async (owner: string, from: string, to: string) => {
          const row = w.rows.get(owner);
          if (row?.agentId === from)
            w.rows.set(owner, { ...row, agentId: to, steps: [], used: false });
        },
      }),
      agents: {
        delete: async (id: string) => {
          w.agents.delete(id);
          w.deleted.push(id);
        },
      } as never,
      withLock: async <T>(owner: string, work: () => Promise<T>) => {
        if (w.lock.held.has(owner)) return { ran: false as const };
        w.lock.held.add(owner);
        try {
          return { ran: true as const, value: await work() };
        } finally {
          w.lock.held.delete(owner);
        }
      },
      owner: ALICE,
      expectedAgentId: ASSISTANT,
      optOutAllowed: async () => true,
      onRemoved: async () => undefined,
      sleep: async () => {
        waits += 1;
        if (waits >= 2) w.lock.held.delete(ALICE);
      },
    } as unknown as Parameters<typeof removeAssistant>[0]);

    expect(await removal).toEqual({ ran: true, value: true });
    expect(waits).toBe(2);
    expect(w.deleted).toEqual([ASSISTANT]);
  });

  // TEST_SCENARIO: a lock that never frees is reported as not done, so the caller keeps the switch on instead of reporting a completed opt-out while the assistant is still there — and the switch is never stored.
  it("reports failure on a lock that never frees", async () => {
    const w = world();
    w.lock.held.add(ALICE);
    expect(await w.removal(ALICE)).toEqual({ ran: false });
    expect(w.deleted).toEqual([]);
    expect(w.rows.get(ALICE)?.used).toBe(true);
    expect(w.stored).toEqual([]);
  });

  // TEST_SCENARIO: a delete that fails stores nothing, so the person is not left opted out with their assistant still there.
  it("stores no switch when the delete fails", async () => {
    const w = world();
    const removal = removeAssistant({
      repo: unused<AssistantsRepository>({
        find: async (owner: string) => w.rows.get(owner) ?? null,
      }),
      agents: {
        delete: async () => {
          throw new Error("the store refused");
        },
      } as never,
      withLock: async <T>(_owner: string, work: () => Promise<T>) => ({
        ran: true as const,
        value: await work(),
      }),
      owner: ALICE,
      expectedAgentId: ASSISTANT,
      optOutAllowed: async () => true,
      onRemoved: async () => {
        throw new Error("the switch must not be stored");
      },
      sleep: async () => undefined,
    } as unknown as Parameters<typeof removeAssistant>[0]);

    await expect(removal).rejects.toThrow("the store refused");
    expect(w.deleted).toEqual([]);
  });

  // TEST_SCENARIO: the delete and the switch are one critical section: the switch is stored while the owner's lock is still held, so no request can take it in between and provision a replacement.
  it("stores the switch inside the owner's lock", async () => {
    const w = world();
    let heldWhenStored: boolean | null = null;
    await w.removal(ALICE, {
      onRemoved: async () => {
        heldWhenStored = w.lock.held.has(ALICE);
      },
    });
    expect(heldWhenStored).toBe(true);
  });

  // TEST_SCENARIO: the reviewer's stale request — this one read the assistant it was going to delete, and another request has since opted the person back in and provisioned a new incarnation. Under the lock the record is no longer the one it read, so it deletes nothing and reports that it did not.
  it("deletes nothing when the record is no longer the one it read", async () => {
    const w = world();
    const staleExpected = ASSISTANT;
    // TEST_SCENARIO: the person opts in again while this request is in flight, so a new incarnation exists.
    w.rows.set(ALICE, {
      ...w.rows.get(ALICE)!,
      incarnation: 2,
      agentId: FRESH,
    });
    w.agents.add(FRESH);

    expect(await w.removal(ALICE, { expectedAgentId: staleExpected })).toEqual({
      ran: true,
      value: false,
    });
    expect(w.deleted).toEqual([]);
    expect(w.agents.has(FRESH)).toBe(true);
  });

  // TEST_SCENARIO: the install moved to mode `on`, where nobody can be opted out, so a turn-off that was already in flight must not delete anything.
  it("deletes nothing when the install no longer lets a person opt out", async () => {
    const w = world();
    expect(await w.removal(ALICE, { optOutAllowed: false })).toEqual({
      ran: true,
      value: false,
    });
    expect(w.deleted).toEqual([]);
    expect(w.rows.get(ALICE)?.used).toBe(true);
  });
});
