import type { FeatureMode } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what an ordinary admitted request does about the
 * assistant: it creates one while the install offers it and the person has it
 * on, and otherwise it does nothing at all — nothing to read in mode `off`.
 * There is no destructive branch and no way to ask for one from here: an
 * assistant is deleted only by its owner's own confirmed turn-off, so a request
 * can never destroy one, whatever the mode or the stored switch says.
 */
export async function provisionOnRequest(deps: {
  mode: FeatureMode;
  eligible: boolean;
  admitted: () => Promise<boolean>;
  provision: () => Promise<void>;
}): Promise<void> {
  if (deps.mode === "off") return;
  if (!deps.eligible) return;
  if (!(await deps.admitted())) return;
  await deps.provision();
}
