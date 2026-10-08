import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";

import {
  createDialogSlice,
  type DialogSlice,
} from "../../modules/platform/store/dialog.js";

describe("dialog close lifecycle", () => {
  it("TEST_SCENARIO: closing keeps the rendered content until the exit animation ends", async () => {
    const store = createStore<DialogSlice>()(createDialogSlice);
    const result = store
      .getState()
      .showConfirm("Keep this message", "Keep this title", {
        confirmLabel: "Proceed",
        cancelLabel: "Stay",
      });

    store.getState().closeDialog(true);

    await expect(result).resolves.toBe(true);
    expect(store.getState().dialog).toMatchObject({
      open: false,
      type: "confirm",
      title: "Keep this title",
      message: "Keep this message",
      confirmLabel: "Proceed",
      cancelLabel: "Stay",
    });

    store.getState().clearClosedDialog();

    expect(store.getState().dialog).toBeNull();
  });
});
