// TEST_OVERVIEW: The Processes section and the header indicator must agree on what the agent is doing. While the agent runs but its socket is down, both keep the last list and the section says it can't reach the agent. While the agent does not run, both stop showing that list.
import type { ProcessList } from "agent-runtime-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

import type { AgentReach } from "../../modules/agents/api/queries.js";

const agent = vi.hoisted(() => ({ reach: "operable" as AgentReach }));

vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentReach: () => agent.reach,
}));
vi.mock("../../modules/processes/api/queries.js", () => ({
  useProcesses: () => ({ data: lastList, isPending: false, isError: false }),
}));
vi.mock("../../modules/processes/components/process-list.js", () => ({
  ProcessList: () => createElement("ul", { "data-testid": "process-list" }),
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ setProcessesSectionOpen: vi.fn(), setMobileScreen: vi.fn() }),
}));

const lastList: ProcessList = {
  running: [
    {
      key: "task-1",
      kind: "harness-task",
      pid: 42,
      command: "bash scripts/ensure-env.sh main",
      startedAt: "2026-10-14T06:46:51Z",
      cpuPercent: null,
      rssBytes: null,
      outputPath: null,
      keepsAwake: true,
      keepSource: "agent",
      container: null,
    },
  ],
  finished: [],
  pendingRestart: null,
};

const { ProcessesPanel } =
  await import("../../modules/processes/components/processes-panel.js");
const { ProcessesIndicator } =
  await import("../../modules/processes/components/processes-indicator.js");

function panel() {
  return renderToStaticMarkup(
    createElement(ProcessesPanel, {
      agentId: "agent-a",
      alwaysOn: false,
      open: true,
      onToggle: () => {},
    }),
  );
}

function indicator() {
  return renderToStaticMarkup(
    createElement(ProcessesIndicator, { agentId: "agent-a" }),
  );
}

beforeEach(() => {
  agent.reach = "operable";
});

// TEST_SCENARIO: the agent runs a long install and the browser loses its socket to the agent. The indicator still counts the task, so the section must show the same list and say why it may be old, not claim the agent is not running.
it("keeps the last list and names the lost connection while the agent is unreachable", () => {
  agent.reach = "unreachable";

  const html = panel();

  expect(html).toContain('data-testid="process-list"');
  expect(html).toContain("Can&#x27;t reach the agent right now.");
  expect(html).not.toContain("once the agent is running");
  expect(indicator()).toContain("1 running");
});

// TEST_SCENARIO: the agent stopped or is restarting, but the last list is still cached. Neither the section nor the indicator may present that list as running work.
it("hides the cached list in both places while the agent does not run", () => {
  agent.reach = "inoperable";

  const html = panel();

  expect(html).toContain("Processes show once the agent is running.");
  expect(html).not.toContain('data-testid="process-list"');
  expect(indicator()).toBe("");
});

// TEST_SCENARIO: a reachable running agent shows its list with no warning.
it("shows the list without a notice while the agent is reachable", () => {
  const html = panel();

  expect(html).toContain('data-testid="process-list"');
  expect(html).not.toContain("Can&#x27;t reach");
  expect(indicator()).toContain("1 running");
});
