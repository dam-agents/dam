// TEST_OVERVIEW: JanUI's sidebar tree keeps which Agents are open across page changes. The open state lives in the store, not in the tree, since the chat and the other pages mount their own sidebar; and the Agent last open in the page stays the one that opens on its own while a page with no Agent, such as Home, shows.
import { expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

vi.mock("../../modules/sessions/api/queries.js", () => ({
  keepFirstSessionPages: () => {},
}));

const { createSidebarSlice } =
  await import("../../modules/platform/store/sidebar.js");
const { isExpanded, toggleExpanded } =
  await import("../../modules/platform/lib/sidebar-tree.js");

// TEST_SCENARIO: the user opens Agent b in a chat of Agent a, then goes Home: a, open on its own, and b, opened by the user, both stay open.
it("keeps open Agents open on a page with no Agent", () => {
  const store = createStore(createSidebarSlice as never);
  const s = () => store.getState() as ReturnType<typeof createSidebarSlice>;
  s().setSidebarTreeOpenAgent("a");
  s().setSidebarTreeToggled(toggleExpanded(s().sidebarTreeToggled, "b", "a"));

  s().setSidebarTreeOpenAgent(null);
  const shown = s().sidebarTreeOpenAgent;
  expect(isExpanded(s().sidebarTreeToggled, "a", shown)).toBe(true);
  expect(isExpanded(s().sidebarTreeToggled, "b", shown)).toBe(true);

  s().setSidebarTreeOpenAgent("c");
  expect(isExpanded(s().sidebarTreeToggled, "a", "c")).toBe(false);
});
