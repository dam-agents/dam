// @vitest-environment happy-dom
// TEST_OVERVIEW: The side panel shell draws one column beside the page. JanUI alone decides the shell around the panel: with JanUI on the rail stays on screen over a narrow page even when the panel is closed, and the panel it lays over the page leaves the left rail standing. The Unified right toolbar experiment makes the panel one tab at a time whatever the shell, so a closed panel hides itself on a page with no rail and takes the whole width when it opens, while a page with no experiment keeps the classic column.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const fake = vi.hoisted(() => ({
  janui: false,
  toolbar: false,
  desktop: false,
  store: {
    dock: null,
    setSidePanelTab: () => {},
    sidePanelMaximized: null as string | null,
    setSidePanelMaximized: () => {},
    mobileScreen: "chat" as "chat" | "files",
    setMobileScreen: () => {},
    view: "chat",
    selectedAgent: "agent",
    agentId: null as string | null,
    sessionId: null as string | null,
    settingsTab: null as string | null,
    sandboxSection: null as string | null,
    starterKitCatalog: null as string | null,
    starterKitId: null as string | null,
  },
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) => select(fake.store),
}));
vi.mock("@/hooks/use-is-desktop", () => ({
  useIsDesktop: () => fake.desktop,
}));
vi.mock("../../modules/features/hooks/use-new-layout.js", () => ({
  useNewLayout: () => fake.janui,
}));
vi.mock("../../modules/features/hooks/use-unified-right-toolbar.js", () => ({
  useUnifiedRightToolbar: () => fake.toolbar,
}));

const { SidePanelShell } =
  await import("../../modules/sessions/components/side-panel-shell.js");

function panelMarkup(activeTab: "files" | null, rail = true): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidePanelShell, {
        activeTab,
        rail,
        hiddenTabs: new Set<never>(),
        onSelectTab: () => {},
        dockedShown: false,
        dockedKept: false,
        panel: activeTab ? createElement("p", null, "panel") : null,
        dock: null,
        mobileTitle: "Files",
        mobileBackLabel: "Close side panel",
        children: createElement("div", null, "page"),
      }),
    ),
  );
}

function panelClasses(activeTab: "files" | null): string[] {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidePanelShell, {
        activeTab,
        hiddenTabs: new Set<never>(),
        onSelectTab: () => {},
        dockedShown: false,
        dockedKept: false,
        panel: activeTab ? createElement("p", null, "panel") : null,
        dock: null,
        mobileTitle: "Files",
        mobileBackLabel: "Close side panel",
        children: createElement("div", null, "page"),
      }),
    ),
  );
  const tag = html.match(/<div[^>]*data-testid="side-panel"[^>]*>/)?.[0] ?? "";
  return (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");
}

beforeEach(() => {
  fake.janui = false;
  fake.toolbar = false;
  fake.desktop = false;
});

// TEST_SCENARIO: with JanUI on the rail is the only way into the panel on a phone, so it stays on screen and in the page's own row while the panel is closed, and only an open panel takes the inset that leaves the left rail standing.
it("keeps the JanUI rail on screen while the panel is closed", () => {
  fake.janui = true;
  const closed = panelClasses(null);
  expect(closed).not.toContain("max-md:fixed");
  expect(closed).not.toContain("max-md:left-14");
  expect(closed).not.toContain("max-md:hidden");

  const open = panelClasses("files");
  expect(open).toContain("max-md:fixed");
  expect(open).toContain("max-md:left-14");
});

// TEST_SCENARIO: the toolbar alone makes the panel one tab at a time on a page with no rail: the closed panel hides itself, and the open one takes the whole width.
it("hides the toolbar-only panel on a phone until it opens", () => {
  fake.toolbar = true;
  const closed = panelClasses(null);
  expect(closed).toContain("max-md:hidden");
  expect(closed).not.toContain("max-md:left-14");

  const open = panelClasses("files");
  expect(open).toContain("max-md:fixed");
  expect(open).toContain("max-md:left-0");
  expect(open).not.toContain("max-md:left-14");
  expect(open).not.toContain("max-md:hidden");
});

// TEST_SCENARIO: with both experiments off the panel stays the classic full-screen column, whether or not it is open.
it("keeps the classic column with both experiments off", () => {
  expect(panelClasses("files")).toContain("max-md:inset-0");
  expect(panelClasses(null)).toContain("max-md:hidden");
});

// TEST_SCENARIO: a page whose panels live outside the shell, as in the current layout, gets no panel column and no rail, so the page takes the window and an empty column never stands beside it.
it("draws no column when the shell has no rail", () => {
  const html = panelMarkup(null, false);
  expect(html).not.toContain('data-testid="side-panel"');
  expect(html).toContain("page");
});
