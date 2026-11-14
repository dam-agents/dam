// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEST_OVERVIEW: the sidebar's starting state: a wide screen opens it expanded
 * until the user picks, a narrow one leaves it collapsed, and a stored choice
 * wins over the screen.
 */

const wide = "platform-sidebar-expanded";

async function expandedWith({
  matches,
  stored,
}: {
  matches: boolean;
  stored?: string;
}) {
  vi.resetModules();
  window.localStorage.clear();
  if (stored !== undefined) window.localStorage.setItem(wide, stored);
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

  // TEST_SCENARIO: a first visit on a wide screen shows the nav with labels, so the user finds the agent and the conversation from earlier.
  it("opens expanded on a wide screen with no choice stored", async () => {
    expect(await expandedWith({ matches: true })).toBe(true);
  });

  it("stays collapsed on a narrow screen with no choice stored", async () => {
    expect(await expandedWith({ matches: false })).toBe(false);
  });

  it("keeps the choice the user stored, whatever the screen", async () => {
    expect(await expandedWith({ matches: true, stored: "0" })).toBe(false);
    expect(await expandedWith({ matches: false, stored: "1" })).toBe(true);
  });
});
