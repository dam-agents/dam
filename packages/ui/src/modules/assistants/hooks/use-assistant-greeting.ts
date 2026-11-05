import { getUser } from "../../../auth.js";
import { getBrand } from "../../../brand.js";
import { useAgent } from "../../agents/api/queries.js";
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
 * none yet: it belongs to the owner's own assistant while the row's mark says it
 * has never been used, so a New chat opens with it even after older sessions and
 * a sent message, which marks it used, takes it away — and a reset brings it
 * back. It is named by the install's brand and the signed-in person's given name
 * rather than by the code. Until the record is in it is `loading`, so the chat
 * shows neither the greeting nor the ordinary empty page before it knows which
 * it is — and an Agent that is not an assistant is answered before the
 * assistant's record is even asked about, so no ordinary chat is ever held back.
 */
export function useAssistantGreeting(
  agentId: string | null,
): AssistantGreetingState {
  const kind = useAgent(agentId)?.kind ?? null;
  const assistantOn = useAssistantOn();
  const state = useAssistantState();
  const listed = state.data;
  const shown = greetingShown({
    kind,
    assistantOn,
    assistantId: listed?.agentId ?? null,
    selectedAgent: agentId,
    used: listed?.used,
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
    kind === "assistant" && assistantOn && agentId !== null && state.isPending;
  return waiting ? LOADING : NONE;
}
