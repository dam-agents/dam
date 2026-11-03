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
import {
  clearSessionDefault,
  rememberSessionPair,
  useProviderConnections,
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
    hint: "New chats start on this model, and channels and schedules follow it unless they pick their own.",
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
  const { owned } = useProviderConnections(agentId);
  const access = useAgent(agentId)?.access;
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const [draft, setDraft] = useState<SessionChoiceSlots | null>(null);
  if (!routesSessionPairs(status?.harnesses ?? [])) return null;
  /* UNIT_BOUNDARY_DESCRIPTION: an agent with no provider to offer has no model to pick; the page it is on says how to connect one. */
  if (owned.length === 0) return null;

  const copy = COPY[kind];
  const chat = saved?.chat ?? null;
  const slots: SessionChoiceSlots =
    draft ??
    (kind === "chat"
      ? {
          profileId: saved?.chatProfileId ?? null,
          pair: chat,
          platformSubagentProfileId: saved?.platformSubagentProfileId ?? null,
          platformSubagentSettings: saved?.platformSubagentSettings ?? null,
        }
      : {
          profileId: null,
          pair: saved?.[kind] ?? null,
          platformSubagentProfileId: null,
          platformSubagentSettings: null,
        });
  const defaultSummary = chat
    ? pairSummary(chat.model, {
        settings: chat.settings,
        capability: status?.harnesses?.find((h) => h.name === chat.harness),
        provider: owned.find((p) => p.id === chat.provider)?.name,
      })
    : "Not set yet";
  const choose = (pair: SessionPair, references: SessionChoiceReferences) => {
    /* UNIT_BOUNDARY_DESCRIPTION: a harness picked without a model waits in the open picker, since a routed runtime keeps no default without one. */
    if (!references.profileId && pair.model === null)
      return setDraft(nextSlots(slots, pair, references));
    setDraft(null);
    /* UNIT_BOUNDARY_DESCRIPTION: only the chat default names a profile; a channel's and a schedule's hold the values their profiles resolve to. */
    rememberSessionPair(
      agentId,
      pair,
      kind,
      undefined,
      kind === "chat" ? references : undefined,
    );
  };

  return (
    <section className="flex flex-col gap-2">
      <div>
        <SectionLabel>{copy.label}</SectionLabel>
        <p className="text-sm text-muted-foreground">{copy.hint}</p>
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
          onConnectProviders={() => navigateToSandboxHome(agentId, "providers")}
          target={{
            slots,
            label: copy.label,
            placeholder: copy.placeholder,
            ...(kind !== "chat" && {
              agentDefault: {
                summary: defaultSummary,
                harness: chat?.harness,
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
