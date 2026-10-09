import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create, type StateCreator } from "zustand";

import {
  createNavigationSlice,
  type NavigationSlice,
} from "../../modules/platform/store/navigation.js";

// TEST_OVERVIEW: Back on a page like the Terms of Use returns to the in-app page the user came from, and falls back to Home when the page was opened directly, so Back never leaves the app or lands somewhere unrelated.

function fakeHistory(initialPath: string) {
  const entries: { state: unknown; path: string }[] = [
    { state: null, path: initialPath },
  ];
  let index = 0;
  return {
    entries,
    get state() {
      return entries[index]!.state;
    },
    get path() {
      return entries[index]!.path;
    },
    pushState(state: unknown, _title: string, path: string) {
      entries.splice(++index, entries.length, { state, path });
    },
    replaceState(state: unknown, _title: string, path: string) {
      entries[index] = { state, path };
    },
    back() {
      index = Math.max(0, index - 1);
    },
  };
}

function storeAt(path: string) {
  const history = fakeHistory(path);
  vi.stubGlobal("history", history);
  vi.stubGlobal("window", {
    location: { pathname: path, origin: "http://ui", search: "", hash: "" },
  });
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  const store = create<NavigationSlice>()(
    createNavigationSlice as unknown as StateCreator<NavigationSlice>,
  );
  return { history, store };
}

describe("navigating back", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("TEST_SCENARIO: Terms opened from Settings goes back to Settings", () => {
    const { history, store } = storeAt("/settings");
    store.getState().setView("terms");

    store.getState().navigateBack();

    expect(history.path).toBe("/settings");
  });

  it("TEST_SCENARIO: Terms opened directly goes to Home", () => {
    const { history, store } = storeAt("/terms");

    store.getState().navigateBack();

    expect(history.path).toBe("/");
    expect(store.getState().view).toBe("home");
  });
});
