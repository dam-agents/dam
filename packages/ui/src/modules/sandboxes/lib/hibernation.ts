import type { DialogSlice } from "../../platform/store/dialog.js";

export function confirmHibernationChange(
  prev: number,
  next: number,
  showConfirm: DialogSlice["showConfirm"],
): Promise<boolean> {
  if (next === 0 && prev !== 0) {
    return showConfirm(
      "This agent will never hibernate — it keeps running, and consuming resources, until you set a timeout again.",
      "Never hibernate",
      { confirmLabel: "Never hibernate" },
    );
  }
  if (prev === 0 && next !== 0) {
    return showConfirm(
      `This agent will hibernate after ${next} min idle. Long-running background work with no open session may be interrupted.`,
      "Allow hibernation",
      { confirmLabel: "Apply" },
    );
  }
  return Promise.resolve(true);
}
