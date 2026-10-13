import type { DialogSlice } from "../../platform/store/dialog.js";

export function confirmHibernationChange(
  prev: number,
  next: number,
  showConfirm: DialogSlice["showConfirm"],
): Promise<boolean> {
  if (next === 0 && prev !== 0) {
    return showConfirm(
      "It keeps running, and keeps its compute reserved, until you set a timeout again.",
      "Never let this agent sleep?",
      { confirmLabel: "Never sleep" },
    );
  }
  if (prev === 0 && next !== 0) {
    return showConfirm(
      `It sleeps after ${next} minutes idle. Long-running background work with no open session may be interrupted.`,
      "Let this agent sleep?",
      { confirmLabel: "Allow sleep" },
    );
  }
  return Promise.resolve(true);
}
