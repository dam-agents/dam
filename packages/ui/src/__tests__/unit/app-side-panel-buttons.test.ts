// @vitest-environment happy-dom
// TEST_OVERVIEW: On a phone, the top bar of a page outside an Agent's chat holds the side panel's buttons. An Agent's configuration page has an Artifacts button that opens that Agent's artifacts; Home and the other pages leave Artifacts to the Artifacts page. With JanUI or the Unified right toolbar on, the side panel offers Artifacts on every page, as before the Artifacts page came back, and Home's Artifacts card and the Getting started artifact task open the side panel.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  view: "home",
  newLayout: false,
  rightToolbar: false,
  openSidePanel: vi.fn(),
  setView: vi.fn(),
  setSidePanelTab: vi.fn(),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({
      view: fake.view,
      setView: fake.setView,
      setSidePanelTab: fake.setSidePanelTab,
      setArtifactsSectionOpen: () => {},
      setMobileScreen: () => {},
    }),
}));
vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: () => false }));
vi.mock("../../modules/features/hooks/use-new-layout.js", () => ({
  useNewLayout: () => fake.newLayout,
}));
vi.mock("../../modules/features/hooks/use-unified-right-toolbar.js", () => ({
  useUnifiedRightToolbar: () => fake.rightToolbar,
}));
vi.mock("../../modules/sessions/hooks/use-app-side-panel-tabs.js", () => ({
  useAppSidePanelTabs: () => ({ gettingStarted: false }),
}));
vi.mock("../../modules/sessions/hooks/use-open-side-panel.js", () => ({
  useOpenSidePanel: () => fake.openSidePanel,
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentsList: () => [],
}));
vi.mock("../../modules/agents/hooks/use-create-default-agent.js", () => ({
  useCreateDefaultAgent: () => ({}),
}));
vi.mock("../../modules/artifacts/api/queries.js", () => ({
  useArtifacts: () => ({ data: [] }),
}));

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { AppSidePanelButtons } =
  await import("../../modules/sessions/components/app-side-panel.js");

function buttons(view: string, withArtifacts: boolean): string[] {
  fake.view = view;
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(AppSidePanelButtons, { withArtifacts }),
    ),
  );
  return [...html.matchAll(/data-testid="side-panel-tab-([a-z-]+)"/g)].map(
    (m) => m[1]!,
  );
}

beforeEach(() => {
  fake.newLayout = false;
  fake.rightToolbar = false;
  vi.clearAllMocks();
});

it("TEST_SCENARIO: an Agent's configuration page on a phone has an Artifacts button, and Home does not", () => {
  expect(buttons("sandbox-home", true)).toEqual(["artifacts", "approvals"]);
  expect(buttons("home", true)).toEqual(["approvals"]);
});

it("TEST_SCENARIO: the chat's top bar keeps its own Artifacts button, so the shared buttons add no second one", () => {
  expect(buttons("sandbox-home", false)).toEqual(["approvals"]);
});

it("TEST_SCENARIO: with JanUI on, every page offers Artifacts in the side panel", () => {
  fake.newLayout = true;
  expect(buttons("home", true)).toEqual(["artifacts", "approvals"]);
});

it("TEST_SCENARIO: with the Unified right toolbar on instead, every page offers Artifacts too", () => {
  fake.rightToolbar = true;
  expect(buttons("home", true)).toEqual(["artifacts", "approvals"]);
});

it("TEST_SCENARIO: JanUI's Home Artifacts card opens the Artifacts side panel, not a page", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { ArtifactsCard } =
    await import("../../modules/home/components/home-cards.js");
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(ArtifactsCard)));
  act(() => container.querySelector("button")!.click());
  act(() => root.unmount());
  expect(fake.openSidePanel).toHaveBeenCalledWith("artifacts");
  expect(fake.setView).not.toHaveBeenCalled();
});

it("TEST_SCENARIO: with the Unified right toolbar on, the Getting started artifact task on Home opens the Artifacts side panel, not a page", async () => {
  fake.rightToolbar = true;
  fake.view = "home";
  const { useStartTask } =
    await import("../../modules/getting-started/hooks/use-start-task.js");
  let start: ((task: "create-artifact") => Promise<void>) | undefined;
  renderToStaticMarkup(
    createElement(() => {
      start = useStartTask();
      return null;
    }),
  );
  await start!("create-artifact");
  expect(fake.setSidePanelTab).toHaveBeenCalledWith("artifacts");
  expect(fake.setView).not.toHaveBeenCalled();
});

it("TEST_SCENARIO: with JanUI on, the Getting started artifact task on Home opens the Artifacts side panel, not a page", async () => {
  fake.newLayout = true;
  fake.view = "home";
  const { useStartTask } =
    await import("../../modules/getting-started/hooks/use-start-task.js");
  let start: ((task: "create-artifact") => Promise<void>) | undefined;
  renderToStaticMarkup(
    createElement(() => {
      start = useStartTask();
      return null;
    }),
  );
  await start!("create-artifact");
  expect(fake.setSidePanelTab).toHaveBeenCalledWith("artifacts");
  expect(fake.setView).not.toHaveBeenCalled();
});
