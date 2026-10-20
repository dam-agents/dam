// TEST_OVERVIEW: The environments composition root's own logic, against a fake repository, agents service and runtime mutator. Deleting an Agent deletes the Environments it owned and an Environment's own row, and no other owner's; the expiry sweep deletes only what expired, as each one's owner, and one failed delete does not stop the rest; a `start` command reaches the Environment as an openrc user service, quoted so the shell runs it as one command.
import { describe, expect, it } from "vitest";
import type { Agent, AgentsService } from "api-server-api";
import type { EnvironmentRecord } from "../../modules/environments/domain/environment.js";
import type { EnvironmentsRepository } from "../../modules/environments/infrastructure/environments-repository.js";
import {
  composeEnvironmentsOver,
  shellQuote,
  startItemCommand,
} from "../../modules/environments/compose.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";

const NOW = new Date();
const PAST = new Date(NOW.getTime() - 60_000);
const LATER = new Date(NOW.getTime() + 86_400_000);

function record(
  agentId: string,
  owningAgentId: string,
  owner: string,
  expiresAt = LATER,
): EnvironmentRecord {
  return {
    agentId,
    owningAgentId,
    owner,
    name: agentId,
    host: `${agentId}-abcdef`,
    endpoints: [],
    access: null,
    expiresAt,
    createdAt: NOW,
  };
}

function world(rows: EnvironmentRecord[], failDelete: string[] = []) {
  const deletedAgents: [string, string][] = [];
  const events: { agentId: string; command: string }[] = [];
  const repo: EnvironmentsRepository = {
    insert: async (r) => void rows.push(r),
    get: async (id) => rows.find((r) => r.agentId === id) ?? null,
    getByHost: async (host) => rows.find((r) => r.host === host) ?? null,
    listByOwningAgent: async (id) => rows.filter((r) => r.owningAgentId === id),
    listExpired: async (now) => rows.filter((r) => r.expiresAt < now),
    listAgentIds: async () => rows.map((r) => r.agentId),
    listOwningAgentIds: async () => [
      ...new Set(rows.map((r) => r.owningAgentId)),
    ],
    findByName: async (owning, name) =>
      rows.find((r) => r.owningAgentId === owning && r.name === name) ?? null,
    update: async () => {},
    delete: async (id) => {
      const i = rows.findIndex((r) => r.agentId === id);
      if (i >= 0) rows.splice(i, 1);
    },
  };
  const agentsFor = (owner: string) =>
    ({
      list: async () => [],
      get: async (id: string) =>
        ({ id, state: "running", spec: { backend: { type: "vm" } } }) as Agent,
      create: async (input: { name: string }) =>
        ({
          id: "agent-new",
          name: input.name,
          state: "starting",
          spec: { backend: { type: "vm" } },
        }) as unknown as Agent,
      delete: async (id: string) => {
        if (failDelete.includes(id)) throw new Error("k8s down");
        deletedAgents.push([owner, id]);
      },
    }) as unknown as AgentsService;
  const runtimeMutator: RuntimeMutator = {
    bump: async (agentId, batch) => {
      for (const e of batch)
        events.push({
          agentId,
          command: (e.payload as { command: string }).command,
        });
      return 1;
    },
    supersede: async () => {},
    enqueueAfterCommit: async () => {},
  };
  const composition = composeEnvironmentsOver(repo, {
    agentsFor,
    runtimeMutator,
    config: {
      urlTemplate: null,
      maxPerAgent: 5,
      expiryMaxDays: 30,
    },
  });
  return { rows, deletedAgents, events, composition };
}

describe("the cleanup source", () => {
  // TEST_SCENARIO: a deleted Owning Agent takes each of its Environments with it, as their owner, and leaves another agent's Environments alone.
  it("deletes the Environments of a deleted Owning Agent, and no others", async () => {
    const { rows, deletedAgents, composition } = world([
      record("agent-env1", "agent-owning", "alice"),
      record("agent-env2", "agent-owning", "alice"),
      record("agent-other", "agent-someone", "bob"),
    ]);

    expect((await composition.cleanupSource.listAgentIds()).sort()).toEqual(
      [
        "agent-env1",
        "agent-env2",
        "agent-other",
        "agent-owning",
        "agent-someone",
      ].sort(),
    );
    await composition.cleanupSource.cleanup("agent-owning");

    expect(deletedAgents).toEqual([
      ["alice", "agent-env1"],
      ["alice", "agent-env2"],
    ]);
    expect(rows.map((r) => r.agentId)).toEqual(["agent-other"]);
  });

  // TEST_SCENARIO: a deleted Environment's own Agent is already gone; only its row is left to delete, and no other Agent is touched.
  it("deletes an Environment's own row when its Agent is deleted", async () => {
    const { rows, deletedAgents, composition } = world([
      record("agent-env1", "agent-owning", "alice"),
    ]);

    await composition.cleanupSource.cleanup("agent-env1");

    expect(deletedAgents).toEqual([]);
    expect(rows).toEqual([]);
  });
});

describe("the expiry sweep", () => {
  // TEST_SCENARIO: only an expired Environment is deleted, as its own owner; a delete that fails is logged and the sweep goes on, and the failed one is tried again on the next sweep.
  it("deletes what expired, as its owner, past a failed delete", async () => {
    const { rows, deletedAgents, composition } = world(
      [
        record("agent-gone1", "agent-owning", "alice", PAST),
        record("agent-stuck", "agent-owning", "alice", PAST),
        record("agent-gone2", "agent-other", "bob", PAST),
        record("agent-kept", "agent-owning", "alice", LATER),
      ],
      ["agent-stuck"],
    );

    await composition.sweepExpired();

    expect(deletedAgents).toEqual([
      ["alice", "agent-gone1"],
      ["bob", "agent-gone2"],
    ]);
    expect(rows.map((r) => r.agentId).sort()).toEqual([
      "agent-kept",
      "agent-stuck",
    ]);
  });
});

describe("the start command", () => {
  // TEST_SCENARIO: the start command reaches the Environment as one shell command that writes it as an openrc user service in ~/.config/rc, on at boot and started now; the command stays one argument of sh -c, single-quoted so neither the workspace shell nor openrc splits or expands it.
  it("delivers the start command as an openrc user service", async () => {
    const { events, composition } = world([]);
    const env = await composition
      .environmentsFor("alice")
      .forOwningAgent("agent-owning")
      .create({
        name: "pr-1",
        endpoints: [{ name: "app", port: 80 }],
        start: "echo 'hi' && $HOME/run",
      })
      .catch((e: unknown) => e);

    expect(env).not.toBeInstanceOf(Error);
    expect(events).toHaveLength(1);
    expect(events[0]!.command).toBe(startItemCommand("echo 'hi' && $HOME/run"));
    expect(events[0]!.command).toContain(
      "ln -sfn $HOME/.config/rc/init.d/start $HOME/.config/rc/runlevels/default/start",
    );
    expect(events[0]!.command).toContain("rc-service --user start start");
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });
});
