// @vitest-environment happy-dom
// TEST_OVERVIEW: The Agent's settings have a Browser section, as the design places it, for an Agent that has a browser: Clear browser data asks the browser panel's confirm, then calls the Agent's runtime to clear it; Restart browser restarts it. An Agent without a browser has no such section.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const runtime = vi.hoisted(() => ({
  clearData: vi.fn(async () => {}),
  restart: vi.fn(async () => {}),
  confirm: vi.fn(async () => true),
}));
vi.mock("../../modules/agents/agent-trpc.js", () => ({
  agentTrpc: () => ({
    browser: {
      clearData: { mutate: runtime.clearData },
      restart: { mutate: runtime.restart },
    },
  }),
}));
vi.mock("../../lib/toast.js", () => ({ emitToast: vi.fn() }));

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { useStore } = await import("../../store.js");
const { SandboxBrowserSection } =
  await import("../../modules/sandboxes/components/sandbox-browser-section.js");

let host: HTMLDivElement;
let root: Root;

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  runtime.clearData.mockClear();
  runtime.restart.mockClear();
  runtime.confirm.mockReset();
  useStore.setState({ showConfirm: runtime.confirm as never });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(SandboxBrowserSection, {
          agentId: "agent-a",
          header: () => createElement("h2", null, "Browser"),
        }),
      ),
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = (id: string) =>
  host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

describe("the Browser section", () => {
  // TEST_SCENARIO: Clear browser data asks the browser panel's confirm, and only a yes clears the Agent's browser.
  it("clears the browser's data after the confirm", async () => {
    runtime.confirm.mockResolvedValueOnce(false);
    act(() => button("browser-clear-data").click());
    await flush();
    expect(runtime.confirm).toHaveBeenCalledWith(
      "Sign-ins, cookies and site data stored in this agent's browser are deleted.",
      "Clear browser data?",
      { kind: "destructive", confirmLabel: "Clear data" },
    );
    expect(runtime.clearData).not.toHaveBeenCalled();
    runtime.confirm.mockResolvedValueOnce(true);
    act(() => button("browser-clear-data").click());
    await flush();
    expect(runtime.clearData).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: Restart browser restarts the Agent's browser at once.
  it("restarts the browser", async () => {
    act(() => button("browser-restart").click());
    await flush();
    expect(runtime.restart).toHaveBeenCalledTimes(1);
  });
});
