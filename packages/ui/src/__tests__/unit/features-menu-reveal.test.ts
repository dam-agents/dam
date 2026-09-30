import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";

import {
  createFeaturesSlice,
  type FeaturesSlice,
} from "../../modules/features/store.js";

/**
 * TEST_OVERVIEW: The hidden Experimental features tab is revealed by tapping
 * the version five times. The settings view must re-render when that happens,
 * even when the URL already points at the hidden tab and navigation changes
 * nothing, so the reveal lives in the store rather than being read from
 * localStorage at render time. The reveal also survives a reload.
 */

describe("revealing the experimental features menu", () => {
  beforeEach(() => {
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("TEST_SCENARIO: subscribers see the reveal and the hide", () => {
    const store = create<FeaturesSlice>()(createFeaturesSlice);
    const seen: boolean[] = [];
    store.subscribe((s) => seen.push(s.featuresMenuRevealed));

    store.getState().setFeaturesMenuRevealed(true);
    store.getState().setFeaturesMenuRevealed(false);

    expect(seen).toEqual([true, false]);
  });

  it("TEST_SCENARIO: a reveal persists across a reload", () => {
    create<FeaturesSlice>()(createFeaturesSlice)
      .getState()
      .setFeaturesMenuRevealed(true);

    const reloaded = create<FeaturesSlice>()(createFeaturesSlice);

    expect(reloaded.getState().featuresMenuRevealed).toBe(true);
  });
});
