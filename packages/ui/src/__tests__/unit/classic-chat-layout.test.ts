import { describe, expect, it } from "vitest";

import {
  classicAppTab,
  classicColumns,
  classicDockToggle,
  classicPanel,
} from "../../modules/sessions/lib/classic-chat-layout.js";
import { hiddenSidePanelTabs } from "../../modules/sessions/lib/side-panel.js";

/**
 * TEST_OVERVIEW: An Agent's chat keeps the
 * layout from before the side panel: Files, Artifacts and Processes are
 * sections in a column beside the conversation, and the docked item (a file,
 * an artifact, the browser, the changes, a process output or a delegation)
 * opens on the right. Approvals is the one tab of the top bar that rides the
 * side panel, and it opens as a drawer over the chat, so it leaves the slot as
 * it is; Get started opens as a dock under the top bar. The side panel's own
 * tabs, Files and the rest, show nothing there: their lists are the sections.
 */

const SHOWN = hiddenSidePanelTabs({
  agent: true,
  artifacts: true,
  canOpenBrowser: true,
  changes: true,
  processesEnabled: true,
});

describe("what the right-hand slot shows", () => {
  it("TEST_SCENARIO: a docked item shows in the slot, whatever list tab the side panel last had, and nothing docked leaves it closed, because a list tab's list is a section beside the conversation", () => {
    expect(classicPanel(true)).toBe("dock");
    expect(classicPanel(false)).toBe(null);
  });

  it("TEST_SCENARIO: Approvals is the one app tab of the top bar, and it opens as a drawer over the chat, so it never takes the slot and the docked item stays in view", () => {
    expect(classicAppTab("approvals", SHOWN)).toBe("approvals");
    expect(classicAppTab("files", SHOWN)).toBe(null);
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

  it("TEST_SCENARIO: an item a phone user hid with Back to chat is not pressed, and a click brings it back", () => {
    expect(
      classicDockToggle({ ...base, panel: "dock", hiddenOnPhone: true }),
    ).toEqual({ pressed: false, click: "reveal" });
  });

  it("TEST_SCENARIO: an item another docked item covers is not pressed, and a click opens it in front; so does a click on an item not docked", () => {
    expect(classicDockToggle({ ...base, panel: "dock", front: false })).toEqual(
      {
        pressed: false,
        click: "open",
      },
    );
    expect(classicDockToggle({ ...base, panel: null, front: false })).toEqual({
      pressed: false,
      click: "open",
    });
    expect(
      classicDockToggle({ ...base, docked: false, panel: "dock" }),
    ).toEqual({ pressed: false, click: "open" });
  });
});
