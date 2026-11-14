import { type AssistantIdea, assistantIdeas } from "api-server-api";

import { getUser } from "../../../auth.js";
import { getBrand } from "../../../brand.js";
import { useAgentConnections } from "../../agents/api/queries.js";
import { useAssistantOn, useAssistantState } from "../api/assistant-state.js";
import {
  type GreetingCopy,
  greetingCopy,
  greetingShown,
  isAssistantChat,
  preferredProviderTemplate,
  providerLineFor,
} from "../lib/greeting.js";

export type AssistantGreetingState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "greeting"; copy: GreetingCopy };

const NONE: AssistantGreetingState = { kind: "none" };
const LOADING: AssistantGreetingState = { kind: "loading" };

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether this chat is the assistant's own, which does
 * not stop being true when a turn runs or its first message is sent: the greeting
 * goes then, but the unlock the platform made still plays here. It stands apart
 * from the greeting because the chat view asks after the greeting only while the
 * chat is idle.
 */
export function useAssistantChat(selectedAgent: string | null): boolean {
  const assistantOn = useAssistantOn();
  const listed = useAssistantState().data;
  return isAssistantChat({
    assistantOn,
    assistantId: listed?.agentId ?? null,
    selectedAgent,
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the ideas the assistant offers, for an empty chat
 * of its own after the greeting is gone: the greeting's words are said once, the
 * ideas are how a person starts a task on any later day.
 */
export function useAssistantIdeas(): readonly AssistantIdea[] {
  return assistantIdeas(getBrand().name);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the greeting this chat opens with, or why it has
 * none yet: it belongs to the owner's own assistant while the record's mark says
 * it has never been used, so a New chat opens with it even after older sessions
 * and a sent message, which marks it used, takes it away — and a reset brings it
 * back. It is named by the install's brand and the signed-in person's given name
 * rather than by the code. Until the record is in it is `loading`, so the
 * assistant's chat shows neither the greeting nor the ordinary empty page before
 * it knows which it is.
 */
export function useAssistantGreeting(
  agentId: string | null,
): AssistantGreetingState {
  const assistantOn = useAssistantOn();
  const state = useAssistantState();
  const granted = useAgentConnections(agentId);
  const listed = state.data;
  const shown = greetingShown({
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
        provider: providerLineFor(preferredProviderTemplate(granted.data)),
      }),
    };
  }
  const waiting = assistantOn && agentId !== null && state.isPending;
  return waiting ? LOADING : NONE;
}
