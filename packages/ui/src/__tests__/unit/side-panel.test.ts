import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";

import { createArtifactsSlice } from "../../modules/artifacts/store.js";
import { createBrowserSlice } from "../../modules/browser/store.js";
import { environmentsTabShown } from "../../modules/environments/lib/environments-tab.js";
import { createFilesSlice } from "../../modules/files/store.js";
import {
  type DockedItems,
  dockedItemTab,
  hiddenSidePanelTabs,
  maximizableView,
  selectSidePanelTab,
  shownSidePanelWidth,
  sidePanelMinWidth,
  visibleSidePanelTab,
} from "../../modules/sessions/lib/side-panel.js";
import { createSidePanelSlice } from "../../modules/sessions/store/side-panel.js";
import type { PlatformStore } from "../../store.js";

/**
 * TEST_OVERVIEW: Every page has one side panel on the right, switched by an
 * icon bar. An Agent's chat offers Files, Browser and Processes, and Changes
 * when the Agent has a git repository;
 * every page offers Get started and Approvals, and the chat and an Agent's
 * configuration page also offer Artifacts.
 * A list tab shows its list, or the docked item it opened (a file, an
 * artifact, a process output). The Changes and Browser tabs show their docked
 * panel and nothing else. Clicking the active icon collapses the panel. A
 * conversation opens with the panel collapsed.
 */

const NOTHING_DOCKED: DockedItems = {
  file: false,
  artifact: false,
  processOutput: false,
  changes: false,
  browser: false,
  delegation: false,
};

const ALL_AVAILABLE = hiddenSidePanelTabs({
  agent: true,
  artifacts: true,
  canOpenBrowser: true,
  changes: true,
  processesEnabled: true,
  environments: true,
  configuration: true,
  chatForms: true,
  gettingStarted: true,
});

function panelStore() {
  return createStore<PlatformStore>()(
    (...a) =>
      ({
        ...createFilesSlice(...a),
        ...createArtifactsSlice(...a),
        ...createBrowserSlice(...a),
        ...createSidePanelSlice(...a),
      }) as PlatformStore,
  );
}

describe("which tab the side panel shows", () => {
  it("TEST_SCENARIO: a docked file belongs to the Files tab, so another tab hides it without closing it", () => {
    const docked = { ...NOTHING_DOCKED, file: true };
    expect(dockedItemTab(docked)).toBe("files");
    expect(visibleSidePanelTab("artifacts", docked, ALL_AVAILABLE)).toBe(
      "artifacts",
    );
  });

  it("TEST_SCENARIO: the Changes and Browser tabs have no list, so with nothing docked there the panel is collapsed", () => {
    expect(visibleSidePanelTab("changes", NOTHING_DOCKED, ALL_AVAILABLE)).toBe(
      null,
    );
    expect(visibleSidePanelTab("browser", NOTHING_DOCKED, ALL_AVAILABLE)).toBe(
      null,
    );
  });

  it("TEST_SCENARIO: an agent without a browser display, or with processes off, never shows those tabs", () => {
    const docked = { ...NOTHING_DOCKED, browser: true };
    const unavailable = hiddenSidePanelTabs({
      agent: true,
      artifacts: true,
      canOpenBrowser: false,
      changes: true,
      processesEnabled: false,
      environments: false,
      configuration: true,
      chatForms: true,
      gettingStarted: true,
    });
    expect(visibleSidePanelTab("browser", docked, unavailable)).toBe(null);
    expect(visibleSidePanelTab("processes", docked, unavailable)).toBe(null);
  });

  it("TEST_SCENARIO: an agent with a git repository has a Changes tab, and one without has none, so a Changes panel left open there closes", () => {
    const noRepository = hiddenSidePanelTabs({
      agent: true,
      artifacts: true,
      canOpenBrowser: true,
      changes: false,
      processesEnabled: true,
      environments: true,
      configuration: true,
      chatForms: true,
      gettingStarted: true,
    });
    expect(ALL_AVAILABLE.has("changes")).toBe(false);
    expect(noRepository.has("changes")).toBe(true);
    expect(
      visibleSidePanelTab(
        "changes",
        { ...NOTHING_DOCKED, changes: true },
        noRepository,
      ),
    ).toBe(null);
    expect(visibleSidePanelTab("files", NOTHING_DOCKED, noRepository)).toBe(
      "files",
    );
  });
});

describe("the Environments tab", () => {
  it("TEST_SCENARIO: JanUI's chat of a vm agent that owns an Environment, with the feature on, has an Environments tab; the current layout, the feature off, a container agent or an agent with none yet has none, so a tab left open there closes", () => {
    const shown = (o: {
      newLayout: boolean;
      enabled: boolean;
      vm: boolean;
      count: number | undefined;
    }) =>
      hiddenSidePanelTabs({
        agent: true,
        artifacts: true,
        canOpenBrowser: true,
        changes: true,
        processesEnabled: true,
        environments: environmentsTabShown(o),
        configuration: true,
        chatForms: true,
        gettingStarted: true,
      });
    expect(
      visibleSidePanelTab(
        "environments",
        NOTHING_DOCKED,
        shown({ newLayout: true, enabled: true, vm: true, count: 1 }),
      ),
    ).toBe("environments");
    for (const off of [
      { newLayout: false, enabled: true, vm: true, count: 1 },
      { newLayout: true, enabled: false, vm: true, count: 1 },
      { newLayout: true, enabled: true, vm: false, count: 1 },
      { newLayout: true, enabled: true, vm: true, count: 0 },
      { newLayout: true, enabled: true, vm: true, count: undefined },
    ])
      expect(
        visibleSidePanelTab("environments", NOTHING_DOCKED, shown(off)),
      ).toBe(null);
  });
});

describe("an Agent's configuration tabs", () => {
  it("TEST_SCENARIO: with the Unified right toolbar on, the chat also offers Connections, Channels, Skills and Schedules, each beside its own panel; with the experiment off, or outside an Agent's chat, none of them exists, so a tab left open closes", () => {
    const available = {
      agent: true,
      artifacts: true,
      canOpenBrowser: true,
      changes: true,
      processesEnabled: true,
      environments: true,
      chatForms: true,
      gettingStarted: true,
    };
    const tabs = ["connections", "channels", "skills", "schedules"] as const;
    for (const tab of tabs) {
      expect(
        visibleSidePanelTab(
          tab,
          NOTHING_DOCKED,
          hiddenSidePanelTabs({ ...available, configuration: true }),
        ),
      ).toBe(tab);
      expect(
        visibleSidePanelTab(
          tab,
          NOTHING_DOCKED,
          hiddenSidePanelTabs({ ...available, configuration: false }),
        ),
      ).toBe(null);
      expect(
        visibleSidePanelTab(
          tab,
          NOTHING_DOCKED,
          hiddenSidePanelTabs({
            ...available,
            agent: false,
            configuration: true,
            chatForms: true,
          }),
        ),
      ).toBe(null);
    }
  });
});

describe("the panels outside an Agent's chat", () => {
  it("TEST_SCENARIO: a page that is not an Agent's chat offers only Get started and Approvals, so an Agent's tab left open there shows nothing, and Artifacts stays on the Artifacts page instead of opening a second time", () => {
    const hidden = hiddenSidePanelTabs({
      agent: false,
      artifacts: false,
      canOpenBrowser: true,
      changes: false,
      processesEnabled: true,
      environments: true,
      configuration: true,
      chatForms: true,
      gettingStarted: true,
    });
    expect(visibleSidePanelTab("files", NOTHING_DOCKED, hidden)).toBe(null);
    expect(visibleSidePanelTab("processes", NOTHING_DOCKED, hidden)).toBe(null);
    expect(visibleSidePanelTab("artifacts", NOTHING_DOCKED, hidden)).toBe(null);
    expect(visibleSidePanelTab("approvals", NOTHING_DOCKED, hidden)).toBe(
      "approvals",
    );
    expect(visibleSidePanelTab("getting-started", NOTHING_DOCKED, hidden)).toBe(
      "getting-started",
    );
  });

  it("TEST_SCENARIO: a dismissed or finished checklist hides Get started, so its panel closes", () => {
    const hidden = hiddenSidePanelTabs({
      agent: true,
      artifacts: true,
      canOpenBrowser: true,
      changes: true,
      processesEnabled: true,
      environments: true,
      configuration: true,
      chatForms: true,
      gettingStarted: false,
    });
    expect(visibleSidePanelTab("getting-started", NOTHING_DOCKED, hidden)).toBe(
      null,
    );
    expect(hidden.has("approvals")).toBe(false);
  });
});

describe("clicking an icon in the bar", () => {
  it("TEST_SCENARIO: the active icon collapses the panel", () => {
    expect(selectSidePanelTab("files", "files", NOTHING_DOCKED)).toEqual({
      kind: "collapse",
    });
  });

  it("TEST_SCENARIO: Changes and Browser open their panel when it is not docked yet, and only switch to it when it is", () => {
    expect(selectSidePanelTab("changes", "files", NOTHING_DOCKED)).toEqual({
      kind: "open-changes",
    });
    expect(selectSidePanelTab("browser", null, NOTHING_DOCKED)).toEqual({
      kind: "open-browser",
    });
    expect(
      selectSidePanelTab("browser", "files", {
        ...NOTHING_DOCKED,
        browser: true,
      }),
    ).toEqual({ kind: "show", tab: "browser" });
  });
});

describe("opening a docked item", () => {
  it("TEST_SCENARIO: a file, the browser or the changes opened from anywhere switch the panel to their own tab", () => {
    const store = panelStore();
    store.getState().setSidePanelTab(null);

    store.getState().setDock({ kind: "file", path: "/home/agent/a.md" });
    expect(store.getState().sidePanelTab).toBe("files");

    store.getState().setOpenBrowser("agent-a");
    expect(store.getState().sidePanelTab).toBe("browser");

    store.getState().setDock({ kind: "changes", agentId: "agent-a" });
    expect(store.getState().sidePanelTab).toBe("changes");
  });
});

describe("a docked item's draft", () => {
  it("TEST_SCENARIO: the panel holds one docked item, so the draft the previous one kept is dropped when another opens", () => {
    const store = panelStore();
    store.getState().setDock({ kind: "file", path: "/a.md" }, { edit: true });
    expect(store.getState().openFileDirty).toBe(false);
    expect(store.getState().openFileEdit).toBe(true);

    store.getState().setDock({ kind: "file", path: "/a.md" });
    store.getState().setOpenFileDirty(true);
    store.getState().setDock({ kind: "artifact", id: "art-1" });
    expect(store.getState().openFileDirty).toBe(false);
    expect(store.getState().openFileEdit).toBe(false);

    store.getState().setOpenArtifactEdit(true);
    store.getState().setOpenArtifactDirty(true);
    store.getState().setDock({ kind: "process-output", key: "proc-1" });
    expect(store.getState().openArtifactDirty).toBe(false);
    expect(store.getState().openArtifactEdit).toBe(false);
  });

  it("TEST_SCENARIO: reopening the artifact the panel already holds keeps its unsaved draft", () => {
    const store = panelStore();
    store.getState().setDock({ kind: "artifact", id: "art-1" });
    store.getState().setOpenArtifactDirty(true);
    store.getState().setDock({ kind: "artifact", id: "art-1" }, { edit: true });
    expect(store.getState().openArtifactDirty).toBe(true);
    expect(store.getState().openArtifactEdit).toBe(true);
  });
});

describe("the panel on load", () => {
  it("TEST_SCENARIO: a conversation opens with the side panel closed and nothing maximized", () => {
    const state = panelStore().getState();
    expect(state.sidePanelTab).toBe(null);
    expect(state.sidePanelMaximized).toBe(null);
  });
});

describe("a maximized panel", () => {
  it("TEST_SCENARIO: collapsing the panel brings the chat back, so the next view opens docked rather than maximized", () => {
    const store = panelStore();
    store.getState().setOpenBrowser("agent-1");
    store.getState().setSidePanelMaximized("browser");
    store.getState().setSidePanelTab(null);
    expect(store.getState().sidePanelMaximized).toBe(null);
  });

  it("TEST_SCENARIO: a link that opens the browser the panel already shows keeps it maximized, so following the agent does not shrink the view", () => {
    const store = panelStore();
    store.getState().setOpenBrowser("agent-1");
    store.getState().setSidePanelMaximized("browser");
    store.getState().setOpenBrowser("agent-1", "http://localhost:4444/");
    expect(store.getState().sidePanelMaximized).toBe("browser");
  });

  it("TEST_SCENARIO: opening a different item ends the maximized view of the one it evicts", () => {
    const store = panelStore();
    store.getState().setOpenBrowser("agent-1");
    store.getState().setSidePanelMaximized("browser");
    store.getState().setDock({ kind: "file", path: "/a.md" });
    expect(store.getState().sidePanelMaximized).toBe(null);
  });

  it("TEST_SCENARIO: closing the browser ends its maximized state", () => {
    const store = panelStore();
    store.getState().setOpenBrowser("agent-1");
    store.getState().setSidePanelMaximized("browser");
    store.getState().setOpenBrowser(null);
    expect(store.getState().sidePanelMaximized).toBe(null);
  });
});

describe("the panel width", () => {
  it("TEST_SCENARIO: a view with a higher minimum, such as the browser, shows wider than the saved width without changing it", () => {
    const min = sidePanelMinWidth("browser");
    expect(min).toBeGreaterThan(sidePanelMinWidth("files"));
    expect(shownSidePanelWidth(300, min, 900)).toBe(min);
    expect(shownSidePanelWidth(300, sidePanelMinWidth("files"), 900)).toBe(300);
  });

  it("TEST_SCENARIO: the panel never takes more than the room the chat leaves, unless the view needs it", () => {
    expect(shownSidePanelWidth(800, 280, 500)).toBe(500);
    expect(shownSidePanelWidth(800, 480, 400)).toBe(480);
  });
});

describe("the maximizable views", () => {
  it("TEST_SCENARIO: only the browser, an open file and an open artifact maximize, and each file or artifact is its own view", () => {
    expect(maximizableView("browser", true, null, null)).toBe("browser");
    expect(maximizableView("files", true, "/a.md", null)).toBe("file:/a.md");
    expect(maximizableView("files", false, "/a.md", null)).toBe(null);
    expect(maximizableView("artifacts", true, null, "a1")).toBe("artifact:a1");
    expect(maximizableView("artifacts", false, null, "a1")).toBe(null);
    expect(maximizableView("artifacts", true, null, null)).toBe(null);
  });
});
