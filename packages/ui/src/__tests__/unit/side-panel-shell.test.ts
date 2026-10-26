// @vitest-environment happy-dom
// TEST_OVERVIEW: The side panel shell draws one column beside the page. On a phone the panel is the classic full-screen column: it hides itself while closed and fills the screen while open. A page whose panels live outside the shell gets no column at all.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const fake = vi.hoisted(() => ({
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
  fake.desktop = false;
});

// TEST_SCENARIO: the panel stays the classic full-screen column, whether or not it is open.
it("keeps the classic column", () => {
  expect(panelClasses("files")).toContain("max-md:inset-0");
  expect(panelClasses(null)).toContain("max-md:hidden");
});

// TEST_SCENARIO: a page whose panels live outside the shell, as in the current layout, gets no panel column and no rail, so the page takes the window and an empty column never stands beside it.
it("draws no column when the shell has no rail", () => {
  const html = panelMarkup(null, false);
  expect(html).not.toContain('data-testid="side-panel"');
  expect(html).toContain("page");
});
