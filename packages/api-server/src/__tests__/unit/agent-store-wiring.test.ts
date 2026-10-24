import { describe, expect, it, vi } from "vitest";

// TEST_OVERVIEW: the composition seams that choose a store. After the switch the
// TEST_OVERVIEW: skills and the L7 host projection must read and write the rows;
// TEST_OVERVIEW: a CR-backed repository there patches a frozen resource, and an
// TEST_OVERVIEW: `ensureReady` that patches the CR would never wake the machine.

const spies = vi.hoisted(() => ({
  crdRepository: vi.fn(() => ({})),
  rowsRepository: vi.fn(() => ({})),
  crdL7: vi.fn(() => ({})),
  rowsL7: vi.fn(() => ({})),
}));

vi.mock("../../modules/agents/infrastructure/agents-repository.js", () => ({
  createAgentsRepository: spies.crdRepository,
}));
vi.mock("../../modules/agent-store/agents-repository.js", () => ({
  createControlAgentsRepository: spies.rowsRepository,
}));
vi.mock(
  "../../modules/egress-rules/infrastructure/k8s-agent-l7-hosts-port.js",
  () => ({ createAgentL7HostsPort: spies.crdL7 }),
);
vi.mock("../../modules/agent-store/l7-hosts-control.js", () => ({
  createControlAgentL7HostsPort: spies.rowsL7,
}));
vi.mock("../../modules/agents/infrastructure/k8s.js", () => ({
  createK8sClient: () => ({}),
}));

const { composeSkillsModule } = await import("../../modules/skills/compose.js");
const { createL7HostsPortFor } =
  await import("../../modules/agent-store/l7-hosts.js");

const skillsDeps = (authority: "crd" | "postgres") => ({
  api: {} as never,
  namespace: "platform-agents",
  owner: "sub-1",
  surface: "ui",
  db: {} as never,
  seedSources: [],
  brandName: "Platform",
  runtimeMutator: {} as never,
  templatesRepo: {} as never,
  runtimeProgress: {} as never,
  agentStateCache: {} as never,
  agentStore: { authority },
});

describe("the store a composition chooses", () => {
  // TEST_SCENARIO: Each authority picks its own repository and L7 port, so nothing reads or patches a frozen custom resource after the switch.
  it("picks the rows in Postgres mode and the custom resources in CR mode", () => {
    composeSkillsModule(skillsDeps("postgres"));
    expect(spies.rowsRepository).toHaveBeenCalledTimes(1);
    expect(spies.crdRepository).not.toHaveBeenCalled();
    composeSkillsModule(skillsDeps("crd"));
    expect(spies.crdRepository).toHaveBeenCalledTimes(1);

    createL7HostsPortFor({
      authority: "postgres",
      k8s: {} as never,
      db: {} as never,
    });
    expect(spies.rowsL7).toHaveBeenCalledTimes(1);
    expect(spies.crdL7).not.toHaveBeenCalled();
    createL7HostsPortFor({
      authority: "crd",
      k8s: {} as never,
      db: {} as never,
    });
    expect(spies.crdL7).toHaveBeenCalledTimes(1);
  });
});
