import { z } from "zod";
import {
  parseQualifiedModel,
  type DefaultKind,
  type DefaultModelNotice,
  type SessionDefaults,
  type SessionPair,
} from "api-server-api";

export const defaultModelNoteSchema = z.object({
  changedFrom: z.string().min(1),
});
export type DefaultModelNote = z.infer<typeof defaultModelNoteSchema>;

const KINDS: readonly DefaultKind[] = ["chat", "channel", "scheduled"];

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the owner of an Agent on the Model Router
 * must know about the defaults its runs use: chat, channel and scheduled,
 * where an unset channel or scheduled default runs on the chat one. An Agent
 * on an older runtime runs a default with no model on its harness's own
 * model, so it says nothing. A pending one (nothing saved yet) says nothing
 * either, since the conversion settles it within minutes. A default with no
 * model is not set, or has no provider to pick from; one whose model names a
 * provider alias the Agent no longer holds cannot run, as runs take the
 * provider from the model's name; a conversion note says the Agent runs
 * another model than its old setting named. A state that stops runs is told
 * only for an Agent that runs something unattended, having an enabled
 * Schedule or a bound Slack or Telegram Channel: nothing fails elsewhere yet.
 * A conversion note is told whatever the Agent runs, since it names the model
 * every run pays for. Kinds that run on the same pair share one notice; one
 * that runs as saved has none. A chat profile that cannot run here is a
 * provider the Agent does not hold.
 */
export function defaultModelNoticesOf(input: {
  agentId: string;
  routed: boolean;
  saved: SessionDefaults;
  note: DefaultModelNote | null;
  grantedAliases: ReadonlySet<string>;
  runsUnattended: boolean;
  profileUnavailable?: boolean;
}): DefaultModelNotice[] {
  const { agentId, saved, note } = input;
  if (!input.routed) return [];
  const groups = new Map<string, DefaultModelNotice>();
  for (const kind of KINDS) {
    const pair = saved[kind] ?? saved.chat;
    if (!pair) continue;
    const runsOnChat = kind === "chat" || saved[kind] === null;
    const state = stateOf(pair, runsOnChat ? note : null, runsOnChat);
    if (!state) continue;
    const key = `${state}\u0000${pair.harness}\u0000${pair.model ?? ""}`;
    const group = groups.get(key);
    if (group) group.kinds.push(kind);
    else
      groups.set(key, {
        id: "",
        agentId,
        kinds: [kind],
        state,
        harness: pair.harness,
        model: pair.model,
        changedFrom: state === "changed" ? (note?.changedFrom ?? null) : null,
      });
  }
  return [...groups.values()].map((notice) => ({
    ...notice,
    id:
      notice.kinds.length === KINDS.length
        ? `${agentId}:${notice.state}`
        : `${agentId}:${notice.kinds.join("+")}:${notice.state}`,
  }));

  function stateOf(
    pair: SessionPair,
    pairNote: DefaultModelNote | null,
    onChat: boolean,
  ): DefaultModelNotice["state"] | null {
    const stopsRuns = (state: DefaultModelNotice["state"]) =>
      input.runsUnattended ? state : null;
    if (onChat && input.profileUnavailable) return stopsRuns("provider-gone");
    if (pair.model === null)
      return stopsRuns(
        input.grantedAliases.size === 0 ? "no-provider" : "not-set",
      );
    const alias = parseQualifiedModel(pair.model, {
      claudePrefix: true,
    })?.alias;
    if (!alias || !input.grantedAliases.has(alias))
      return stopsRuns("provider-gone");
    if (pairNote) return "changed";
    return null;
  }
}
