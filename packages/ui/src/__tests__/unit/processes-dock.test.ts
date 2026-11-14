// @vitest-environment happy-dom
// TEST_OVERVIEW: The Agent's processes docked beside the conversation: the panel closes with the side panel's own close button, which a phone leaves to its Back bar, and a process's output returns to the docked processes on a desktop, while a phone, which keeps them in its sections screen, closes the dock to show them again.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const viewport = vi.hoisted(() => ({ desktop: true }));
vi.mock("../../hooks/use-is-desktop.js", () => ({
  useIsDesktop: () => viewport.desktop,
}));
vi.mock("../../modules/processes/api/queries.js", () => ({
  useProcesses: () => ({ data: undefined, isPending: true, isError: false }),
  useProcessOutput: () => ({ data: undefined, isPending: true }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentReach: () => "operable",
}));

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { DockedProcessesPanel } =
  await import("../../modules/processes/components/docked-processes-panel.js");
const { DockedProcessOutputPanel } =
  await import("../../modules/processes/components/docked-process-output-panel.js");
const { useStore } = await import("../../store.js");

let host: HTMLDivElement;
let root: Root;

function render(node: ReactNode) {
  act(() => root.render(createElement(TooltipProvider, null, node)));
}
const button = (label: string) =>
  host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);

beforeEach(() => {
  viewport.desktop = true;
  useStore.setState({ dock: { kind: "processes", agentId: "agent-a" } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the docked processes", () => {
  // TEST_SCENARIO: the panel's close is the side panel's own button, hidden on a phone, where the Back bar closes the dock; a click takes the processes away.
  it("closes with the side panel's close button", () => {
    render(createElement(DockedProcessesPanel, { agentId: "agent-a" }));
    const close = button("Close panel")!;
    expect(close.parentElement!.className).toContain("max-md:hidden");
    act(() => close.click());
    expect(useStore.getState().dock).toBeNull();
  });
});

describe("a process's output", () => {
  // TEST_SCENARIO: on a desktop, Back returns to the docked processes rather than closing the dock.
  it("goes back to the docked processes on a desktop", () => {
    useStore.setState({ dock: { kind: "process-output", key: "p1" } });
    render(
      createElement(DockedProcessOutputPanel, {
        agentId: "agent-a",
        outputKey: "p1",
      }),
    );
    act(() => button("Back to processes")!.click());
    expect(useStore.getState().dock).toEqual({
      kind: "processes",
      agentId: "agent-a",
    });
  });

  // TEST_SCENARIO: on a phone, Back closes the dock, so the sections screen with the processes shows again.
  it("closes the dock on a phone", () => {
    viewport.desktop = false;
    useStore.setState({ dock: { kind: "process-output", key: "p1" } });
    render(
      createElement(DockedProcessOutputPanel, {
        agentId: "agent-a",
        outputKey: "p1",
      }),
    );
    act(() => button("Back to processes")!.click());
    expect(useStore.getState().dock).toBeNull();
  });
});
