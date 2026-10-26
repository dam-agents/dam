// @vitest-environment happy-dom
// TEST_OVERVIEW: The pages beside an Agent's chat take their room from the whole window while both experiments are off: no side-panel shell and no right icon column stand beside Home or Settings, and only a docked artifact, or either experiment turned on, brings the shell and its rail back.
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  janui: false,
  toolbar: false,
  store: {
    dock: null as { kind: string; id: string } | null,
    openArtifactDirty: false,
    sidePanelTab: null as string | null,
    view: "home",
    agentId: null as string | null,
    setSidePanelTab: () => {},
  },
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) => select(fake.store),
}));
vi.mock("../../modules/features/hooks/use-new-layout.js", () => ({
  useNewLayout: () => fake.janui,
}));
vi.mock("../../modules/features/hooks/use-unified-right-toolbar.js", () => ({
  useUnifiedRightToolbar: () => fake.toolbar,
}));
vi.mock("../../modules/sessions/hooks/use-app-side-panel-tabs.js", () => ({
  useAppSidePanelTabs: () => ({ gettingStarted: false, icons: {}, badges: {} }),
}));
vi.mock("../../modules/sessions/components/side-panel-shell.js", async () => {
  const { createElement } = await import("react");
  return {
    SidePanelShell: ({ children }: { children?: ReactNode }) =>
      createElement("div", { "data-testid": "side-panel-shell" }, children),
  };
});

const { AppSidePanelHost } =
  await import("../../modules/sessions/components/app-side-panel.js");

function rendered(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(
        AppSidePanelHost,
        null,
        createElement("div", { "data-testid": "page" }),
      ),
    ),
  );
  return container;
}

beforeEach(() => {
  fake.janui = false;
  fake.toolbar = false;
  fake.store.dock = null;
  fake.store.sidePanelTab = null;
  fake.store.view = "home";
});

// TEST_SCENARIO: with both experiments off and nothing docked, a page fills the window and no shell or rail stands beside it.
it("leaves the page the whole window while both experiments are off", () => {
  const container = rendered();
  expect(container.querySelector('[data-testid="page"]')).not.toBeNull();
  expect(
    container.querySelector('[data-testid="side-panel-shell"]'),
  ).toBeNull();
});

// TEST_SCENARIO: a docked artifact still takes the shell beside the page with both experiments off, because the artifact shows there.
it("keeps the shell for a docked artifact", () => {
  fake.store.dock = { kind: "artifact", id: "artifact-1" };
  fake.store.sidePanelTab = "artifacts";
  fake.store.view = "artifacts";
  const container = rendered();
  expect(
    container.querySelector('[data-testid="side-panel-shell"]'),
  ).not.toBeNull();
});

// TEST_SCENARIO: with either experiment on, the shell and its rail are beside the page as before, even with nothing open.
it("keeps the shell while an experiment is on", () => {
  fake.toolbar = true;
  expect(
    rendered().querySelector('[data-testid="side-panel-shell"]'),
  ).not.toBeNull();
  fake.toolbar = false;
  fake.janui = true;
  expect(
    rendered().querySelector('[data-testid="side-panel-shell"]'),
  ).not.toBeNull();
});
