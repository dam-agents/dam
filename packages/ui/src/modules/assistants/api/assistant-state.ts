import { useQuery } from "@tanstack/react-query";
import {
  type AssistantState,
  type FeatureMode,
  featureOnForUser,
} from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import {
  useFeatures,
  useInstallCapabilities,
} from "../../features/api/queries.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether this person has an assistant to hear about:
 * the install's mode decides — `on` for everyone, `off` for nobody, whether or
 * not the settings tab still shows a switch — except in `experimental`, where
 * their own switch does. `known` says whether both answers are in, so a caller
 * that must not decide on a guess can wait. Nothing is asked of the server for
 * anyone it is off for.
 */
export function assistantGate(
  mode: FeatureMode | undefined,
  stored: boolean | undefined,
): { on: boolean; known: boolean } {
  if (mode === undefined) return { on: false, known: false };
  if (mode !== "experimental") return { on: mode === "on", known: true };
  if (stored === undefined) return { on: false, known: false };
  return { on: featureOnForUser(mode, stored), known: true };
}

export function useAssistantGate(): { on: boolean; known: boolean } {
  const install = useInstallCapabilities();
  const mode = install.data?.features.dambledore;
  const flags = useFeatures(mode === "experimental");
  if (!install.isSuccess) return { on: false, known: false };
  return assistantGate(
    mode,
    flags.isSuccess ? (flags.data.dambledore ?? false) : undefined,
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: whether the person has the assistant, as far as the client knows; the landing asks `useAssistantGate` when it must also know that the answer is in. */
export function useAssistantOn(): boolean {
  return useAssistantGate().on;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Sessions this tab has seen start, which the
 * server's answer may not know yet. A response that was in flight when the mark
 * was set — or any response from a replica that has not seen the report — carries
 * `used: false`, and must not take the mark back: only the server's own `used:
 * true` retires it, so a reset's answer shows the greeting again.
 */
const markedUsedHere = new Set<string>();

export function usedAfterLocalMark(
  state: AssistantState | null | undefined,
  marked: ReadonlySet<string>,
): AssistantState | null | undefined {
  if (!state || state.used || !marked.has(state.agentId)) return state;
  return { ...state, used: true };
}

/** UNIT_BOUNDARY_DESCRIPTION: the record as the query answers it: the local mark decides until the server says the assistant is used, which retires the mark so a later reset — the server saying unused again — brings the greeting back. */
export function assistantStateFor(
  state: AssistantState | null | undefined,
): AssistantState | null | undefined {
  if (state?.used) markedUsedHere.delete(state.agentId);
  return usedAfterLocalMark(state, markedUsedHere);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the server knows about the owner's assistant
 * without waking it — which Agent it is, and whether it has ever been used, as
 * the local marks above leave it — and the call that starts their onboarding
 * over. A person the assistant is off for is asked nothing at all.
 */
export function useAssistantState() {
  return useQuery({
    ...trpc.assistants.state.queryOptions(),
    enabled: useAssistantOn(),
    select: assistantStateFor,
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a Session that just appeared is the fact the
 * assistant's record learns only when the session report reaches the api-server.
 * Marking it here closes that window, so a New chat in the same page load does
 * not bring the greeting back.
 */
export function markAssistantUsed(agentId: string): void {
  markedUsedHere.add(agentId);
  queryClient.setQueryData(trpc.assistants.state.queryKey(), (prev) =>
    prev?.agentId === agentId && !prev.used ? { ...prev, used: true } : prev,
  );
}
