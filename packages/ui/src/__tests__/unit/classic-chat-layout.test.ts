import { describe, expect, it } from "vitest";

import {
  classicAppTab,
  classicColumns,
  classicDockToggle,
  classicPanel,
} from "../../modules/sessions/lib/classic-chat-layout.js";
import { hiddenSidePanelTabs } from "../../modules/sessions/lib/side-panel.js";

/**
 * TEST_OVERVIEW: With the new-layout experiment off, an Agent's chat keeps the
 * layout from before the side panel: Files, Artifacts and Processes are
 * sections in a column beside the conversation, and the docked item (a file,
 * an artifact, the browser, the changes, a process output or a delegation)
 * opens on the right. Get started and Approvals open in that same slot from
 * the top bar, and the docked item waits behind them. The side panel's own
 * tabs, Files and the rest, show nothing there: their lists are the sections.
 */

const SHOWN = hiddenSidePanelTabs({
  agent: true,
  artifacts: true,
  canOpenBrowser: true,
  processesEnabled: true,
  gettingStarted: true,
});

describe("what the right-hand slot shows", () => {
  it("TEST_SCENARIO: a docked item shows while no app tab is open, whatever list tab the side panel last had", () => {
    expect(classicPanel("files", SHOWN, true)).toBe("dock");
    expect(classicPanel("artifacts", SHOWN, true)).toBe("dock");
    expect(classicPanel(null, SHOWN, true)).toBe("dock");
  });

  it("TEST_SCENARIO: a list tab with nothing docked leaves the slot closed, because its list is a section beside the conversation", () => {
    expect(classicPanel("files", SHOWN, false)).toBe(null);
    expect(classicPanel("processes", SHOWN, false)).toBe(null);
  });

  it("TEST_SCENARIO: Approvals and Get started take the slot over a docked item, which comes back when they close", () => {
    expect(classicPanel("approvals", SHOWN, true)).toBe("approvals");
    expect(classicPanel("getting-started", SHOWN, false)).toBe(
      "getting-started",
    );
    expect(classicAppTab("approvals", SHOWN)).toBe("approvals");
    expect(classicAppTab("files", SHOWN)).toBe(null);
  });

  it("TEST_SCENARIO: a finished or dismissed checklist hides Get started, so the slot falls back to the docked item", () => {
    const hidden = hiddenSidePanelTabs({
      agent: true,
      artifacts: true,
      canOpenBrowser: true,
      processesEnabled: true,
      gettingStarted: false,
    });
    expect(classicPanel("getting-started", hidden, true)).toBe("dock");
    expect(classicPanel("getting-started", hidden, false)).toBe(null);
  });
});

describe("how the columns share the width", () => {
  it("TEST_SCENARIO: an open slot fills the view when the sections, the conversation and the slot do not fit side by side", () => {
    expect(
      classicColumns({
        columnsW: 700,
        leftW: 240,
        savedPanelW: null,
        panelOpen: true,
        panelMaximized: false,
      }).panelFills,
    ).toBe(true);
    expect(
      classicColumns({
        columnsW: 1200,
        leftW: 240,
        savedPanelW: null,
        panelOpen: true,
        panelMaximized: false,
      }).panelFills,
    ).toBe(false);
  });

  it("TEST_SCENARIO: a maximized item fills the view however wide it is", () => {
    expect(
      classicColumns({
        columnsW: 1600,
        leftW: 240,
        savedPanelW: 500,
        panelOpen: true,
        panelMaximized: true,
      }).panelFills,
    ).toBe(true);
  });

  it("TEST_SCENARIO: a saved slot width shrinks to leave the conversation its minimum, but never below the slot's own", () => {
    expect(
      classicColumns({
        columnsW: 1000,
        leftW: 240,
        savedPanelW: 900,
        panelOpen: true,
        panelMaximized: false,
      }).panelW,
    ).toBe(440);
    expect(
      classicColumns({
        columnsW: 900,
        leftW: 400,
        savedPanelW: 900,
        panelOpen: true,
        panelMaximized: false,
      }).panelW,
    ).toBe(320);
  });
});

describe("the top bar's browser and changes toggles", () => {
  const base = { docked: true, front: true, hiddenOnPhone: false } as const;

  it("TEST_SCENARIO: an item the slot shows is pressed, and a click closes it", () => {
    expect(classicDockToggle({ ...base, panel: "dock" })).toEqual({
      pressed: true,
      click: "close",
    });
  });

  it("TEST_SCENARIO: an item docked behind Approvals or Get started is not pressed, and a click brings it back instead of closing it", () => {
    for (const panel of ["approvals", "getting-started"] as const)
      expect(classicDockToggle({ ...base, panel })).toEqual({
        pressed: false,
        click: "reveal",
      });
  });

  it("TEST_SCENARIO: an item a phone user hid with Back to chat is not pressed, and a click brings it back", () => {
    expect(
      classicDockToggle({ ...base, panel: "dock", hiddenOnPhone: true }),
    ).toEqual({ pressed: false, click: "reveal" });
  });

  it("TEST_SCENARIO: an item another docked item covers is not pressed, and a click opens it in front; so does a click on an item not docked", () => {
    for (const panel of ["dock", "approvals"] as const)
      expect(classicDockToggle({ ...base, panel, front: false })).toEqual({
        pressed: false,
        click: "open",
      });
    expect(
      classicDockToggle({ ...base, docked: false, panel: "dock" }),
    ).toEqual({ pressed: false, click: "open" });
  });
});
