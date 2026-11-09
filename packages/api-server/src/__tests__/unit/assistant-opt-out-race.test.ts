// TEST_OVERVIEW: A turn-off and a create share one critical section. A request that read the assistant as on, then paused before taking the owner's lock, must not create one after the person has switched it off: provisioning reads the switch again inside that lock, where the turn-off stores it, so the stale request finds it off and creates nothing. Without the re-check it resurrects the assistant and no later request removes it.
import { describe, expect, it } from "vitest";
import type { AgentInitStep } from "api-server-api";
import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import type {
  AssistantRow,
  AssistantsRepository,
} from "../../modules/assistants/infrastructure/assistants-repository.js";
import { assistantAgentId } from "../../modules/assistants/domain/agent-id.js";
import { createAssistantProvisioner } from "../../modules/assistants/services/assistant-provisioner.js";

const OWNER = "alice";
const NAME = "Dambledore";
const FIRST = assistantAgentId(OWNER, 1);
const SECOND = assistantAgentId(OWNER, 2);

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one owner, one row, one Agent, and a switch the test
 * controls — enough for the interleaving: a create that reads the switch before
 * the lock, a turn-off that deletes and stores the switch inside it.
 */
function world() {
  const row: AssistantRow = {
    owner: OWNER,
    incarnation: 1,
    agentId: FIRST,
    state: "ready",
    steps: [],
    used: true,
    renamed: null,
    noticeSeen: false,
  };
  const agents = new Set([FIRST]);
  const created: string[] = [];
  const repo = unused<AssistantsRepository>({
    find: async () => row,
    start: async () => false,
    nextIncarnation: async (_owner: string, _from: string, to: string) => {
      row.agentId = to;
      row.incarnation += 1;
      return true;
    },
    markInitStep: async (
      _owner: string,
      _agentId: string,
      step: AgentInitStep,
    ) => {
      if (!row.steps.includes(step)) row.steps = [...row.steps, step];
    },
    markReady: async () => undefined,
    forgetAll: async (_owner: string, _from: string, to: string) => {
      row.agentId = to;
      row.incarnation += 1;
      row.steps = [];
      row.state = "creating";
      row.used = false;
    },
  });
  return {
    row,
    agents,
    created,
    repo,
    agentOf: async (id: string) =>
      agents.has(id)
        ? ({ id, name: NAME, owner: OWNER, spec: {} } as unknown as InfraAgent)
        : null,
  };
}

describe("a request that read the assistant as on, and a turn-off", () => {
  // TEST_SCENARIO: the request reads "on", pauses before the owner's lock, the person's turn-off deletes the assistant and stores the switch off, and the request resumes. It reads the switch again inside the lock, finds it off, and creates nothing — no replacement is left behind.
  it("creates nothing once the person has switched the assistant off meanwhile", async () => {
    const w = world();
    let switchedOn = true;
    let releaseEnabled!: (value: boolean) => void;
    const firstEnabledRead = new Promise<boolean>((resolve) => {
      releaseEnabled = resolve;
    });
    let enabledReads = 0;
    const provisioner = createAssistantProvisioner({
      repo: w.repo,
      ownName: OWNER,
      assistantName: NAME,
      brandName: "DAM",
      admitted: async () => true,
      enabled: async () => {
        enabledReads += 1;
        if (enabledReads === 1) return firstEnabledRead;
        return switchedOn;
      },
      agentOf: w.agentOf,
      agents: {
        list: async () => [],
        create: async (input: {
          id?: string;
          name: string;
          kind?: "assistant";
        }) => {
          const made = input.id as string;
          createdOrThrow();
          return { id: made, name: input.name, kind: input.kind };
        },
        update: async () => null,
      } as never,
      enrolled: async () => undefined,
      provisioned: async () => undefined,
      withLock: async <T>(_owner: string, work: () => Promise<T>) => ({
        ran: true as const,
        value: await work(),
      }),
    });
    function createdOrThrow() {
      w.created.push(OWNER);
      w.agents.add(SECOND);
    }

    const request = provisioner.ensure();
    // TEST_SCENARIO: the person's own turn-off, in the owner's critical section: the delete and the switch together.
    w.agents.delete(FIRST);
    await w.repo.forgetAll(OWNER, FIRST, SECOND);
    switchedOn = false;
    releaseEnabled(true);
    await request;

    expect(enabledReads).toBe(2);
    expect(w.created).toEqual([]);
    expect(w.agents.has(SECOND)).toBe(false);
    expect(w.row.agentId).toBe(SECOND);
    expect(w.row.incarnation).toBe(2);
  });

  // TEST_SCENARIO: the control — with the switch still on, the same resume does create the incarnation it read.
  it("creates when the switch is still on", async () => {
    const w = world();
    let releaseEnabled!: (value: boolean) => void;
    const firstEnabledRead = new Promise<boolean>((resolve) => {
      releaseEnabled = resolve;
    });
    let enabledReads = 0;
    const provisioner = createAssistantProvisioner({
      repo: w.repo,
      ownName: OWNER,
      assistantName: NAME,
      brandName: "DAM",
      admitted: async () => true,
      enabled: async () => {
        enabledReads += 1;
        if (enabledReads === 1) return firstEnabledRead;
        return true;
      },
      agentOf: w.agentOf,
      agents: {
        list: async () => [],
        create: async (input: {
          id?: string;
          name: string;
          kind?: "assistant";
        }) => {
          w.created.push(input.id as string);
          return { id: input.id as string, name: input.name, kind: input.kind };
        },
        update: async () => null,
      } as never,
      enrolled: async () => undefined,
      provisioned: async () => undefined,
      withLock: async <T>(_owner: string, work: () => Promise<T>) => ({
        ran: true as const,
        value: await work(),
      }),
    });

    const request = provisioner.ensure();
    w.agents.delete(FIRST);
    await w.repo.forgetAll(OWNER, FIRST, SECOND);
    releaseEnabled(true);
    await request;

    expect(w.created).toEqual([SECOND]);
  });
});
