import { getUser } from "../../../auth.js";
import { getBrand } from "../../../brand.js";
import { useAgentSessionQuery } from "../../sessions/api/queries.js";
import { useAssistantOn, useAssistantState } from "../api/assistant-state.js";
import {
  type GreetingCopy,
  greetingCopy,
  greetingShown,
} from "../lib/greeting.js";

export type AssistantGreetingState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "greeting"; copy: GreetingCopy };

const NONE: AssistantGreetingState = { kind: "none" };
const LOADING: AssistantGreetingState = { kind: "loading" };

/**
 * UNIT_BOUNDARY_DESCRIPTION: the greeting this chat opens with, or why it has
 * none yet: it belongs to the owner's own assistant, only while that assistant
 * has never had a session — said by the row's mark and by the Agent's own list
 * of sessions, so a New chat after the first message does not bring it back —
 * and it is named by the install's brand and the signed-in person's given name
 * rather than by the code. Until both answers are in it is `loading`, so the
 * chat shows neither the greeting nor the ordinary empty page before it knows
 * which it is.
 */
export function useAssistantGreeting(
  agentId: string | null,
): AssistantGreetingState {
  const assistantOn = useAssistantOn();
  const state = useAssistantState();
  const listed = state.data;
  const unused =
    agentId !== null &&
    assistantOn &&
    listed?.agentId === agentId &&
    !listed.used;
  const sessions = useAgentSessionQuery(
    agentId,
    { limit: 1 },
    {
      enabled: unused,
    },
  );
  const shown = greetingShown({
    assistantOn,
    assistantId: listed?.agentId ?? null,
    selectedAgent: agentId,
    used: listed?.used,
    sessionsListed: sessions.isPending ? undefined : sessions.data?.length,
  });
  if (shown) {
    const brand = getBrand();
    const givenName = getUser()?.profile.given_name;
    return {
      kind: "greeting",
      copy: greetingCopy({
        firstName: typeof givenName === "string" ? givenName : null,
        assistantName: brand.assistantName,
        brandName: brand.name,
      }),
    };
  }
  const waiting =
    (assistantOn && agentId !== null && state.isPending) ||
    (unused && sessions.isPending);
  return waiting ? LOADING : NONE;
}
