import { type HarnessCapability, routesSessionPairs } from "agent-runtime-api";

import type { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import type { useAgentSession } from "../api/queries.js";
import { useProviderConnections } from "../api/session-pair.js";
import { useNextSessionPair } from "./use-next-session-pair.js";

type Status = ReturnType<typeof useHarnessConfigStatus>["data"];
type Session = ReturnType<typeof useAgentSession>["data"];

interface ChoiceStatus {
  harnesses?: readonly HarnessCapability[] | null | undefined;
  catalog?: unknown;
  defaultHarness?: string | null | undefined;
  modelRouter?: boolean | undefined;
}

export type NewSessionChoice =
  | { kind: "nothing" }
  | { kind: "pending"; agentId: string }
  | {
      kind: "picker";
      agentId: string;
      carried: readonly HarnessCapability[];
      defaultHarness: string;
      routed: boolean;
    }
  | { kind: "outdated"; agentId: string }
  | { kind: "session"; harness: string }
  | { kind: "defaults"; agentId: string };

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the composer's footer offers below the chat:
 * the picker a new session starts on, a loader while the agent reports its
 * harnesses, the running session's model, the notice that its harnesses predate
 * the model router, or a way to configure defaults. A session already open
 * takes none of the new-session branches.
 */
export function newSessionChoice(input: {
  agentId: string | null;
  sessionId: string | null;
  status: ChoiceStatus | undefined;
  statusPending: boolean;
  operable: boolean;
  sessionHarness: string | undefined;
}): { choice: NewSessionChoice; newSessionAgent: string | null } {
  const { agentId, sessionId, status, statusPending, operable } = input;
  const carried = status?.harnesses ?? [];
  const pairOutdated = carried.length > 0 && !routesSessionPairs(carried);
  const harnessesPending =
    !status?.harnesses && !status?.catalog && (statusPending || !operable);
  const newSessionAgent =
    !sessionId && (carried.length > 0 || harnessesPending) ? agentId : null;
  const choice: NewSessionChoice =
    newSessionAgent && carried.length > 0 && !pairOutdated
      ? {
          kind: "picker",
          agentId: newSessionAgent,
          carried,
          defaultHarness: status?.defaultHarness ?? carried[0]!.name,
          routed: status?.modelRouter ?? false,
        }
      : newSessionAgent && harnessesPending
        ? { kind: "pending", agentId: newSessionAgent }
        : agentId && pairOutdated
          ? { kind: "outdated", agentId }
          : agentId && input.sessionHarness
            ? { kind: "session", harness: input.sessionHarness }
            : agentId
              ? { kind: "defaults", agentId }
              : { kind: "nothing" };
  return { choice, newSessionAgent };
}

export interface NewSessionChoiceResult {
  choice: NewSessionChoice;
  newSessionAgent: string | null;
  pair: ReturnType<typeof useNextSessionPair>;
  pairHarness: string | null;
  noProviders: boolean;
  noGrantedProvider: boolean;
}

export function useNewSessionChoice({
  agentId,
  sessionId,
  status,
  statusPending,
  operable,
  session,
}: {
  agentId: string | null;
  sessionId: string | null;
  status: Status;
  statusPending: boolean;
  operable: boolean;
  session: Session;
}): NewSessionChoiceResult {
  const carried = status?.harnesses ?? [];
  const sessionHarness =
    session?.harness ??
    (session && status?.modelRouter
      ? (status.defaultHarness ?? carried[0]?.name)
      : undefined);
  const { choice, newSessionAgent } = newSessionChoice({
    agentId,
    sessionId,
    status,
    statusPending,
    operable,
    sessionHarness,
  });
  const providerConnections = useProviderConnections(newSessionAgent);
  const pair = useNextSessionPair(
    choice.kind === "picker" && choice.routed ? choice.agentId : null,
    carried.map((h) => h.name),
    choice.kind === "picker" ? choice.defaultHarness : undefined,
  );

  return {
    choice,
    newSessionAgent,
    pair,
    pairHarness:
      choice.kind === "picker"
        ? (pair?.harness ?? choice.defaultHarness)
        : (pair?.harness ?? null),
    noProviders:
      !!newSessionAgent &&
      providerConnections.loaded &&
      providerConnections.owned.length === 0,
    noGrantedProvider:
      !!newSessionAgent &&
      providerConnections.loaded &&
      providerConnections.granted.length === 0,
  };
}
