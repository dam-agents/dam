import type { DialogSlice } from "../../platform/store/dialog.js";

// Confirms the keep-awake toggle: enabling always prompts; disabling prompts only when an agent pin holds the agent awake.
export function confirmKeepAwakeToggle(
  on: boolean,
  keptAwakeByPin: boolean,
  showConfirm: DialogSlice["showConfirm"],
): Promise<boolean> {
  if (on) {
    return showConfirm(
      "This agent will never hibernate — it keeps running, and consuming resources, until you stop it.",
      "Keep awake",
      { confirmLabel: "Keep awake" },
    );
  }
  if (keptAwakeByPin) {
    return showConfirm(
      "An agent workload is keeping this agent awake. Turning keep-awake off may let it hibernate and interrupt that work.",
      "Turn off keep-awake",
      { confirmLabel: "Turn off" },
    );
  }
  return Promise.resolve(true);
}
