import type { FeatureMode } from "api-server-api";

export type AssistantRequestWork = "none" | "provision" | "reconcile";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what one admitted request does about the assistant:
 * nothing at all while the install's mode is `off`, so an install that offers no
 * assistant costs no read; a create while the person has it on, which is everyone
 * in `on`, since that mode leaves nobody opted out; and otherwise the
 * reconciliation that finishes an opt-out whose delete could not take the
 * owner's lock the first time.
 */
export function assistantRequestWork(
  mode: FeatureMode,
  on: boolean,
): AssistantRequestWork {
  if (mode === "off") return "none";
  if (mode === "on") return "provision";
  return on ? "provision" : "reconcile";
}
