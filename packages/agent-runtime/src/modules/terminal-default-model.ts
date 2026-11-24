import type { SessionDefaultPair } from "agent-runtime-api";
import { canonicalModel } from "./acp/services/lease-router.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model a new web terminal opened with none
 * starts on. The chat default's model, when that default is on the
 * terminal's harness and its provider is still granted, since the chip shows
 * that model and a harness's own default is only whatever its catalog lists
 * first; otherwise none, and the terminal starts on the harness's own default.
 * The person still switches the model in the harness's own screen.
 */
export function terminalDefaultModel(input: {
  harness: string;
  chatDefault: SessionDefaultPair | null | undefined;
  granted: (model: string) => boolean;
}): string | null {
  const { chatDefault } = input;
  if (!chatDefault || chatDefault.harness !== input.harness) return null;
  if (chatDefault.model === null) return null;
  const model = canonicalModel(chatDefault.model);
  return input.granted(model) ? model : null;
}
