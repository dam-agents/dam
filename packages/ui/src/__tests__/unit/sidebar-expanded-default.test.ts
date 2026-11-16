// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEST_OVERVIEW: the sidebar's starting state: it opens expanded at every
 * window width until the user collapses it, and a stored choice wins.
 */

const key = "platform-sidebar-expanded";

async function expandedWith({
  matches,
  stored,
}: {
  matches: boolean;
  stored?: string;
}) {
  vi.resetModules();
  window.localStorage.clear();
  if (stored !== undefined) window.localStorage.setItem(key, stored);
  const matchMedia = vi
    .spyOn(window, "matchMedia")
    .mockReturnValue({ matches } as MediaQueryList);
  const { useStore } = await import("../../store.js");
  matchMedia.mockRestore();
  return useStore.getState().sidebarExpanded;
}

describe("the sidebar's starting state", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  // TEST_SCENARIO: a first visit on a wide window shows the nav with labels, so the user finds the agent and the conversation from earlier.
  it("opens expanded on a wide window with no choice stored", async () => {
    expect(await expandedWith({ matches: true })).toBe(true);
  });

  // TEST_SCENARIO: a first visit on a narrow window shows the nav with labels too, so a new user never meets the unlabelled rail.
  it("opens expanded on a narrow window with no choice stored", async () => {
    expect(await expandedWith({ matches: false })).toBe(true);
  });

  // TEST_SCENARIO: a user who collapsed the sidebar finds it collapsed after a reload, and one who expanded it finds it expanded.
  it("keeps the choice the user stored, whatever the window", async () => {
    expect(await expandedWith({ matches: true, stored: "0" })).toBe(false);
    expect(await expandedWith({ matches: false, stored: "0" })).toBe(false);
    expect(await expandedWith({ matches: false, stored: "1" })).toBe(true);
  });
});
