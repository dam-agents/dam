// TEST_OVERVIEW: Pinning or unpinning from the keyboard keeps focus on the moved row's pin button, or on its Agent's row when the row's new place is closed. An Agent list that is still sliding closed keeps its rows in the page, inert, so focus must skip a pin button inside an inert container rather than land where it cannot go. In the flat All sessions list there may be neither the row nor an Agent row, and focus still lands on a control.
import { expect, it, vi } from "vitest";

vi.stubGlobal("window", new EventTarget());
vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("CSS", { escape: (s: string) => s });
vi.stubGlobal("requestAnimationFrame", (run: () => void) => run());

const focused: string[] = [];
const button = (name: string, inert: boolean) => ({
  focus: () => focused.push(name),
  closest: (selector: string) => (selector === "[inert]" && inert ? {} : null),
});

vi.mock("../../store.js", () => ({
  useStore: Object.assign(() => undefined, { getState: () => ({}) }),
}));
vi.mock("../../modules/sessions/lib/pinned-sessions.js", () => ({
  pinKey: (a: string, s: string) => `${a}:${s}`,
  readPinnedSessions: () => new Set(["a:s1"]),
  togglePinnedSession: () => {},
  unpinSession: () => {},
}));

const { togglePinKeepingFocus } =
  await import("../../modules/platform/components/sidebar-v2/tree-session-row.js");
const dom = { agentRow: true };
vi.stubGlobal("document", {
  activeElement: { closest: () => ({ getAttribute: () => "a:s1" }) },
  querySelectorAll: () => [button("closing list", true)],
  querySelector: (selector: string) =>
    selector.includes("aria-pressed")
      ? button("closing list", true)
      : selector.includes("sidebar-group-by")
        ? button("group by", false)
        : dom.agentRow
          ? button("agent row", false)
          : null,
});

// TEST_SCENARIO: the user closes the Agent and at once unpins its Session from the keyboard; the Session's only row is in the closing, inert list, so focus goes to the Agent row.
it("skips a pin button in an inert, closing list", () => {
  focused.length = 0;
  togglePinKeepingFocus("a:s1", "a");
  expect(focused).toEqual(["agent row"]);
});

// TEST_SCENARIO: grouped as all sessions, the tree has no Agent rows and shows only the first pages of the flat list, so an unpinned Session that falls off them has no row to take focus; focus goes to the Group by control instead of being dropped.
it("falls back to the Group by control when no row or Agent row shows", () => {
  focused.length = 0;
  dom.agentRow = false;
  togglePinKeepingFocus("a:s1", "a");
  expect(focused).toEqual(["group by"]);
  dom.agentRow = true;
});
