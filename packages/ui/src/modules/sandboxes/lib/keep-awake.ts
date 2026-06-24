import type { DialogSlice } from "../../platform/store/dialog.js";

// The agent env var that pins an agent awake (hard hibernation blocker).
// Set it truthy and agent-runtime reports never-idle. Shared by the create
// wizard and the settings form so the two surfaces can't drift.
export const KEEP_AWAKE_ENV = "PLATFORM_KEEP_AWAKE";

// One confirmation for the keep-awake toggle, shared by both surfaces. Returns
// true to proceed: enabling prompts first (it disables hibernation
// indefinitely), disabling never does.
export function confirmEnableKeepAwake(
  on: boolean,
  showConfirm: DialogSlice["showConfirm"],
): Promise<boolean> {
  if (!on) return Promise.resolve(true);
  return showConfirm(
    "This agent will never hibernate — it keeps running, and consuming resources, until you stop it.",
    "Keep awake",
    { confirmLabel: "Keep awake" },
  );
}
