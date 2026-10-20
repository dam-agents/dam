import { z } from "zod";
import {
  parseQualifiedModel,
  type DefaultModelNotice,
  type SessionPair,
} from "api-server-api";

export const defaultModelNoteSchema = z.object({
  changedFrom: z.string().min(1),
});
export type DefaultModelNote = z.infer<typeof defaultModelNoteSchema>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the owner of an Agent on the Model Router
 * must know about its saved default; an Agent on an older runtime runs a
 * default with no model on its harness's own model, so it says nothing. A
 * pending one (nothing saved yet) says nothing either, since the conversion
 * settles it within minutes. A default with no model is not set, or has no
 * provider to pick from; one whose model names a provider alias the Agent no
 * longer holds cannot run, as runs take the provider from the model's name;
 * a conversion note says the Agent runs another model than its old setting
 * named. Null when the default runs as saved, and null for a state that stops
 * runs on an Agent that runs nothing unattended, having no enabled Schedule and
 * no bound Slack or Telegram Channel: nothing fails there yet. A conversion
 * note is told whoever the Agent's runs are, since it names the model every
 * one of them pays for.
 */
export function defaultModelNoticeOf(input: {
  agentId: string;
  routed: boolean;
  pair: SessionPair | null;
  note: DefaultModelNote | null;
  grantedAliases: ReadonlySet<string>;
  runsUnattended: boolean;
}): DefaultModelNotice | null {
  const { agentId, pair, note } = input;
  if (!input.routed || !pair) return null;
  const notice = (state: DefaultModelNotice["state"]): DefaultModelNotice => ({
    id: `${agentId}:${state}`,
    agentId,
    state,
    harness: pair.harness,
    model: pair.model,
    changedFrom: state === "changed" ? (note?.changedFrom ?? null) : null,
  });
  const stopsRuns = (state: DefaultModelNotice["state"]) =>
    input.runsUnattended ? notice(state) : null;
  if (pair.model === null)
    return stopsRuns(
      input.grantedAliases.size === 0 ? "no-provider" : "not-set",
    );
  const alias = parseQualifiedModel(pair.model, { claudePrefix: true })?.alias;
  if (!alias || !input.grantedAliases.has(alias))
    return stopsRuns("provider-gone");
  if (note) return notice("changed");
  return null;
}
