// @vitest-environment happy-dom
// TEST_OVERVIEW: The pages beside an Agent's chat take their room from the whole window: the shell draws no right column and no rail, and only a docked artifact brings the column back. The page stays inside the shell's own column in every state, so a panel that opens or closes never remounts it and its scroll and search text survive.
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const fake = vi.hoisted(() => ({
  store: {
    dock: null as { kind: string; id: string } | null,
    openArtifactDirty: false,
    sidePanelTab: null as string | null,
    sidePanelMaximized: null as string | null,
    mobileScreen: "chat" as "chat" | "files",
    view: "home",
    agentId: null as string | null,
    selectedAgent: null as string | null,
    sessionId: null as string | null,
    settingsTab: null as string | null,
    sandboxSection: null as string | null,
    starterKitCatalog: null as string | null,
    starterKitId: null as string | null,
    setSidePanelTab: () => {},
    setSidePanelMaximized: () => {},
    setMobileScreen: () => {},
  },
}));

const page = vi.hoisted(() => ({ mounts: 0 }));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) => select(fake.store),
}));
vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("../../modules/sessions/hooks/use-app-side-panel-tabs.js", () => ({
  useAppSidePanelTabs: () => ({ gettingStarted: false, icons: {}, badges: {} }),
}));
vi.mock("../../modules/artifacts/components/chat-artifacts-panel.js", () => ({
  ChatArtifactsPanel: () => null,
}));
vi.mock("../../modules/artifacts/components/docked-artifact-panel.js", () => ({
  DockedArtifactPanel: () => null,
}));

const { AppSidePanelHost } =
  await import("../../modules/sessions/components/app-side-panel.js");

function Page() {
  const [mount] = useState(() => {
    page.mounts += 1;
    return page.mounts;
  });
  return createElement("div", {
    "data-testid": "page",
    "data-mount": String(mount),
  });
}

function mountHost(): {
  container: HTMLElement;
  render: () => void;
} {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    act(() =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(AppSidePanelHost, null, createElement(Page)),
        ),
      ),
    );
  render();
  return { container, render };
}

beforeEach(() => {
  fake.store.dock = null;
  fake.store.openArtifactDirty = false;
  fake.store.sidePanelTab = null;
  fake.store.view = "home";
  page.mounts = 0;
});

// TEST_SCENARIO: with nothing docked, a page fills the window and no column or rail stands beside it.
it("leaves the page the whole window while nothing is docked", () => {
  const { container } = mountHost();
  expect(container.querySelector('[data-testid="page"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="side-panel"]')).toBeNull();
  expect(container.querySelector('[data-testid="side-panel-bar"]')).toBeNull();
});

// TEST_SCENARIO: opening a docked artifact brings the column and its rail back, and the page beside them keeps its own instance: opening and closing the artifact never remounts the page, so its search text and scroll survive.
it("docks and closes an artifact without remounting the page", () => {
  const { container, render } = mountHost();
  expect(page.mounts).toBe(1);

  fake.store.dock = { kind: "artifact", id: "artifact-1" };
  fake.store.sidePanelTab = "artifacts";
  fake.store.view = "artifacts";
  render();
  expect(container.querySelector('[data-testid="side-panel"]')).not.toBeNull();
  expect(page.mounts).toBe(1);

  fake.store.dock = null;
  fake.store.sidePanelTab = null;
  render();
  expect(container.querySelector('[data-testid="side-panel"]')).toBeNull();
  expect(page.mounts).toBe(1);
});
