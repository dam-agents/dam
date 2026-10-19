import { z } from "zod";
import type { DefaultModelNotice, SessionPair } from "api-server-api";

export const defaultModelNoteSchema = z.object({
  changedFrom: z.string().min(1),
});
export type DefaultModelNote = z.infer<typeof defaultModelNoteSchema>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: what an Agent's owner must know about its saved
 * default. A pending one (nothing saved yet) says nothing, since the
 * conversion settles it within minutes; a default with no model is not set;
 * one whose provider the Agent no longer holds cannot run; a conversion note
 * says the Agent runs another model than its old setting named. Null when
 * the default runs as saved.
 */
export function defaultModelNoticeOf(input: {
  agentId: string;
  pair: SessionPair | null;
  note: DefaultModelNote | null;
  grantedProviders: ReadonlySet<string>;
}): DefaultModelNotice | null {
  const { agentId, pair, note } = input;
  if (!pair) return null;
  const notice = (state: DefaultModelNotice["state"]): DefaultModelNotice => ({
    agentId,
    state,
    harness: pair.harness,
    model: pair.model,
    changedFrom: state === "changed" ? (note?.changedFrom ?? null) : null,
  });
  if (pair.model === null) return notice("not-set");
  if (pair.provider !== null && !input.grantedProviders.has(pair.provider))
    return notice("provider-gone");
  if (note) return notice("changed");
  return null;
}
