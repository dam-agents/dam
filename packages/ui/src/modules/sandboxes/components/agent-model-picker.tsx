import { routesSessionPairs } from "agent-runtime-api";
import type {
  DefaultKind,
  SessionChoiceReferences,
  SessionChoiceSlots,
  SessionPair,
} from "api-server-api";
import { useState } from "react";

import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useAgent } from "../../agents/api/queries.js";
import { holds } from "../../agents/lib/agent-permissions.js";
import { shortProviderName } from "../../providers/lib/provider-rows.js";
import {
  clearSessionDefault,
  rememberSessionPair,
  useProviderConnections,
  useRememberedPair,
  useSessionDefaults,
} from "../../sessions/api/session-pair.js";
import { SessionPairPicker } from "../../sessions/components/session-pair-picker.js";
import { pairSummary } from "../../sessions/lib/session-settings.js";
import { nextSlots } from "../../sessions/lib/subagent-choice.js";

const COPY: Record<
  DefaultKind,
  { label: string; hint: string; placeholder: string }
> = {
  chat: {
    label: "Default model",
    hint: "New chats start on this model. A channel or schedule with no pick of its own follows its page's model, which is this one until that page sets it.",
    placeholder: "Choose a model",
  },
  channel: {
    label: "Model for channels",
    hint: "Channels that pick nothing of their own run on this.",
    placeholder: "Use agent default",
  },
  scheduled: {
    label: "Model for schedules",
    hint: "Schedules that pick nothing of their own run on this.",
    placeholder: "Use agent default",
  },
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: what an agent's chats, channel turns or schedule
 * fires run on, picked on its configuration page with the chat's own picker as
 * a row card. A channel and a schedule follow the default model unless they
 * pick their own, which their list's first row clears.
 */
export function AgentModelPicker({
  agentId,
  kind,
}: {
  agentId: string;
  kind: DefaultKind;
}) {
  const { data: status } = useHarnessConfigStatus(agentId);
  const saved = useSessionDefaults(agentId).data;
  const { data: remembered } = useRememberedPair(agentId);
  const { owned } = useProviderConnections(agentId);
  const access = useAgent(agentId)?.access;
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const [draft, setDraft] = useState<SessionChoiceSlots | null>(null);
  if (!routesSessionPairs(status?.harnesses ?? [])) return null;
  /* UNIT_BOUNDARY_DESCRIPTION: an agent with no provider to offer has no model to pick; the page it is on says how to connect one. */
  if (owned.length === 0) return null;

  const copy = COPY[kind];
  const chat = saved?.chat ?? null;
  /* UNIT_BOUNDARY_DESCRIPTION: with no model saved, runs take the automatic model the api-server resolves from the agent's providers, so the card names it instead of asking for a pick. */
  const automatic = !chat?.model && remembered?.model ? remembered : null;
  const shown = automatic ?? chat;
  const slots: SessionChoiceSlots =
    draft ??
    (kind === "chat"
      ? {
          profileId: saved?.chatProfileId ?? null,
          pair: shown,
          platformSubagentProfileId: saved?.platformSubagentProfileId ?? null,
          platformSubagentSettings: saved?.platformSubagentSettings ?? null,
        }
      : {
          profileId: null,
          pair: saved?.[kind] ?? null,
          platformSubagentProfileId: null,
          platformSubagentSettings: null,
        });
  const defaultSummary = shown
    ? pairSummary(shown.model, {
        settings: shown.settings,
        capability: status?.harnesses?.find((h) => h.name === shown.harness),
        provider: (() => {
          const connection = owned.find((p) => p.id === shown.provider);
          return connection ? shortProviderName(connection) : undefined;
        })(),
      })
    : null;
  /* UNIT_BOUNDARY_DESCRIPTION: only the chat default names a primary profile; a channel's and a schedule's hold the values their profiles resolve to, while the subagent slot's own values reach every kind. */
  const choiceReferences = (references: SessionChoiceReferences) => ({
    ...(kind === "chat" && { profileId: references.profileId }),
    ...(references.platformSubagentProfileId !== undefined && {
      platformSubagentProfileId: references.platformSubagentProfileId,
    }),
  });
  const choose = (
    pair: SessionPair,
    references: SessionChoiceReferences,
    effective = pair,
  ) => {
    const nextReferences = choiceReferences(references);
    /* UNIT_BOUNDARY_DESCRIPTION: a harness picked without a model waits in the open picker, since a routed runtime keeps no default without one. */
    if (!references.profileId && pair.model === null)
      return setDraft(nextSlots(slots, effective, nextReferences));
    setDraft(null);
    /* UNIT_BOUNDARY_DESCRIPTION: only the chat default stores a reference; every kind stores the values a run shows, so a channel or a schedule keeps the subagent its profile lends. */
    return rememberSessionPair(
      agentId,
      kind === "chat" ? pair : effective,
      kind,
      undefined,
      nextReferences,
      effective,
    );
  };

  return (
    <section className="flex flex-col gap-2">
      <div>
        <SectionLabel>{copy.label}</SectionLabel>
        <p className="text-sm text-muted-foreground">
          {kind === "chat" && automatic
            ? `Nothing is saved, so new chats and runs use ${defaultSummary}, picked automatically from this agent's providers. Pick a model to keep one.`
            : copy.hint}
        </p>
      </div>
      <fieldset
        disabled={!!access && !holds(access, "settings")}
        className="min-w-0"
      >
        <SessionPairPicker
          agentId={agentId}
          carried={status?.harnesses ?? []}
          defaultHarness={status?.defaultHarness ?? ""}
          routed={status?.modelRouter ?? false}
          row
          onOpenChange={(open) => {
            /* UNIT_BOUNDARY_DESCRIPTION: a harness picked without a model waits in the open picker alone, so closing it drops the draft rather than leaving the page's card on a pick nothing saved. */
            if (!open && draft?.pair?.model === null) setDraft(null);
          }}
          onConnectProviders={() => navigateToSandboxHome(agentId, "providers")}
          target={{
            valueOnly: kind !== "chat",
            slots,
            label: copy.label,
            placeholder: copy.placeholder,
            ...(kind !== "chat" && {
              agentDefault: {
                detail: defaultSummary
                  ? `Follows ${defaultSummary}`
                  : "No default set yet",
                harness: shown?.harness,
                pair: shown,
                onClear: () => {
                  setDraft(null);
                  clearSessionDefault(agentId, kind);
                },
              },
            }),
            onChoose: choose,
          }}
        />
      </fieldset>
    </section>
  );
}
