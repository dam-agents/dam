import { getUser } from "../../../auth.js";
import { getBrand } from "../../../brand.js";
import { useAgentConnections } from "../../agents/api/queries.js";
import { useAssistantOn, useAssistantState } from "../api/assistant-state.js";
import {
  type GreetingCopy,
  greetingCopy,
  greetingShown,
  providerLineFor,
} from "../lib/greeting.js";

export type AssistantGreetingState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "greeting"; copy: GreetingCopy };

const NONE: AssistantGreetingState = { kind: "none" };
const LOADING: AssistantGreetingState = { kind: "loading" };

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

/* UNIT_BOUNDARY_DESCRIPTION: the template of the provider Connection the Agent runs on — the one the person marked preferred, else the first — so the greeting names the provider it actually has rather than one it does not. */
function preferredProviderTemplate(
  data:
    | {
        connections: readonly {
          preferred: boolean;
          connection?: { templateId: string };
        }[];
      }
    | undefined,
): string | undefined {
  if (!data) return undefined;
  const providers = data.connections.filter((c) => c.connection !== undefined);
  const chosen = providers.find((c) => c.preferred) ?? providers[0];
  return chosen?.connection?.templateId;
}
