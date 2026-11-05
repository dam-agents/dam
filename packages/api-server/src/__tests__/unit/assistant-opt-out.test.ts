// TEST_OVERVIEW: Switching the assistant off for one person deletes their assistant the way any Agent delete does, and forgets the record so opting in again makes a new one. It touches nobody else, is a no-op for someone with no assistant, leaves the Agent that was renamed to free the reserved name exactly as it is, and runs under the owner's provisioning lock so it cannot interleave with a create.
import { describe, expect, it } from "vitest";
import type {
  AssistantRow,
  AssistantsRepository,
} from "../../modules/assistants/infrastructure/assistants-repository.js";
import { assistantAgentId } from "../../modules/assistants/domain/agent-id.js";
import {
  reconcileOptOut,
  removeAssistant,
} from "../../modules/assistants/services/assistant-removal.js";

const ALICE = "alice";
const BOB = "bob";
const ASSISTANT = assistantAgentId(ALICE, 1);

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
        steps: ["env", "egress", "grants"],
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
  const removal = (owner: string, opts: Record<string, unknown> = {}) =>
    removeAssistant({
      repo,
      agents: { delete: deleteAgent } as never,
      withLock,
      owner,
      sleep: async () => undefined,
      ...opts,
    } as unknown as Parameters<typeof removeAssistant>[0]);
  const reconcile = (owner: string) =>
    reconcileOptOut({
      repo,
      agents: { delete: deleteAgent } as never,
      withLock,
      owner,
      sleep: async () => undefined,
    } as unknown as Parameters<typeof reconcileOptOut>[0]);
  return { rows, agents, deleted, removal, reconcile, lock };
}

describe("switching the assistant off for one person", () => {
  // TEST_SCENARIO: the caller's assistant is deleted through the ordinary Agent delete, and their record is forgotten: the next incarnation's Agent id, nothing initialized, never used, and no rename news.
  it("deletes the caller's assistant and forgets its record", async () => {
    const w = world();
    await w.removal(ALICE);

    expect(w.deleted).toEqual([ASSISTANT]);
    expect(w.rows.get(ALICE)).toMatchObject({
      incarnation: 2,
      agentId: assistantAgentId(ALICE, 2),
      state: "creating",
      steps: [],
      used: false,
      renamed: null,
    });
    expect(w.rows.get(ALICE)?.agentId).not.toBe(ASSISTANT);
  });

  // TEST_SCENARIO: nobody else's assistant is touched, and the Agent the record renamed to free the reserved name stays exactly as it was — a person's own Agent is never renamed back.
  it("leaves another person's assistant and the renamed Agent alone", async () => {
    const w = world();
    const renamedAgent = "agent-old";
    await w.removal(ALICE);

    expect(w.deleted).toEqual([ASSISTANT]);
    expect(w.rows.get(BOB)?.agentId).toBe(assistantAgentId(BOB, 1));
    expect(w.deleted).not.toContain(renamedAgent);
  });

  // TEST_SCENARIO: a person with no assistant is a no-op, and the next opt-in starts from nothing rather than from a half-forgotten record.
  it("is a no-op for a person with no assistant", async () => {
    const w = world();
    await expect(w.removal("carol")).resolves.toEqual({
      ran: true,
      value: undefined,
    });
    expect(w.deleted).toEqual([]);
    expect(w.rows.has("carol")).toBe(false);
  });

  // TEST_SCENARIO: a turn-off that meets the owner's provisioning lock waits for it briefly instead of leaving the delete undone: once the lock frees, the assistant goes and the record is forgotten.
  it("waits for the lock and then deletes", async () => {
    const w = world();
    w.lock.held.add(ALICE);
    let waits = 0;
    const removal = w.removal(ALICE, {
      sleep: async () => {
        waits += 1;
        if (waits >= 2) w.lock.held.delete(ALICE);
      },
    } as never);

    expect(await removal).toEqual({ ran: true, value: undefined });
    expect(waits).toBe(2);
    expect(w.deleted).toEqual([ASSISTANT]);
    expect(w.rows.get(ALICE)?.used).toBe(false);
  });

  // TEST_SCENARIO: a lock that never frees is reported rather than waited on for ever, so the caller can tell the person the switch stayed on and the flag is never switched off behind an assistant that is still there.
  it("gives up on a lock that never frees", async () => {
    const w = world();
    w.lock.held.add(ALICE);
    expect(await w.removal(ALICE, { lockAttempts: 2 })).toEqual({
      ran: false,
    });
    expect(w.deleted).toEqual([]);
    expect(w.rows.get(ALICE)?.used).toBe(true);
  });

  // TEST_SCENARIO: the next admitted request finishes an opt-out that could not take the lock: the record and its Agent are still there, so the reconciliation deletes them; a request while the lock is still held leaves it to the next one.
  it("finishes the delete on the next request", async () => {
    const w = world();
    w.lock.held.add(ALICE);
    await w.reconcile(ALICE);
    expect(w.deleted).toEqual([]);

    w.lock.held.delete(ALICE);
    await w.reconcile(ALICE);
    expect(w.deleted).toEqual([ASSISTANT]);
    expect(w.rows.get(ALICE)).toMatchObject({
      incarnation: 2,
      agentId: assistantAgentId(ALICE, 2),
      used: false,
      steps: [],
    });
  });
});
