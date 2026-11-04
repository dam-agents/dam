import { getUser } from "../../../auth.js";
import { getBrand } from "../../../brand.js";
import { useAssistantOn, useAssistantState } from "../api/assistant-state.js";
import {
  type GreetingCopy,
  greetingCopy,
  greetingShown,
} from "../lib/greeting.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the greeting this chat opens with, or nothing: it
 * belongs to the owner's own assistant, only while that assistant has never had
 * a session and the caller says the chat is still untouched, and it is named by
 * the install's brand and the signed-in person's given name rather than by the
 * code.
 */
export function useAssistantGreeting(
  agentId: string | null,
): GreetingCopy | null {
  const assistantOn = useAssistantOn();
  const { data: state } = useAssistantState();
  const brand = getBrand();
  const givenName = getUser()?.profile.given_name;
  const shown = greetingShown({
    assistantOn,
    assistantId: state?.agentId ?? null,
    selectedAgent: agentId,
    used: state?.used,
  });
  if (!shown) return null;
  return greetingCopy({
    firstName: typeof givenName === "string" ? givenName : null,
    assistantName: brand.assistantName,
    brandName: brand.name,
  });
}
