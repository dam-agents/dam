// @vitest-environment happy-dom
// TEST_OVERVIEW: On a phone, the top bar of a page outside an Agent's chat holds the side panel's buttons. An Agent's configuration page has an Artifacts button that opens that Agent's artifacts; Home and the other pages leave Artifacts to the Artifacts page, and the Getting started artifact task opens that page.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  view: "home",
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
  vi.clearAllMocks();
});

it("TEST_SCENARIO: an Agent's configuration page on a phone has an Artifacts button, and Home does not", () => {
  expect(buttons("sandbox-home", true)).toEqual(["artifacts", "approvals"]);
  expect(buttons("home", true)).toEqual(["approvals"]);
});

it("TEST_SCENARIO: the chat's top bar keeps its own Artifacts button, so the shared buttons add no second one", () => {
  expect(buttons("sandbox-home", false)).toEqual(["approvals"]);
});

it("TEST_SCENARIO: the Getting started artifact task on Home opens the Artifacts page, not the side panel", async () => {
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
  expect(fake.setView).toHaveBeenCalledWith("artifacts");
  expect(fake.setSidePanelTab).not.toHaveBeenCalled();
});
