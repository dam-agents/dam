import { useQuery } from "@tanstack/react-query";
import type {
  SessionChoiceReferences,
  SessionChoiceSlots,
  SessionPair,
} from "api-server-api";
import { useState } from "react";

import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import { SessionPairPicker } from "../../sessions/components/session-pair-picker.js";
import { nextSlots } from "../../sessions/lib/subagent-choice.js";
import { useSetNewAgentDefault } from "../api/mutations.js";

const LABEL = "Default for new agents";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the owner's default for new agents in Settings ›
 * Providers, picked with the agent config's picker as a row card: a profile or
 * values of their own. A new agent's own default model is initialised from it;
 * that one then decides what the agent's new chats run on. While the owner
 * chose nothing it shows the base default new agents start on.
 */
export function NewAgentDefaultPicker() {
  const { data: status } = useQuery(trpc.connections.catalog.queryOptions());
  const { data: chosen } = useQuery(
    trpc.profiles.newAgentDefault.queryOptions(),
  );
  const set = useSetNewAgentDefault();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const [draft, setDraft] = useState<SessionChoiceSlots | null>(null);
  if (!status?.harnesses?.length || !chosen) return null;

  const slots: SessionChoiceSlots = draft ?? {
    profileId: chosen.profileId,
    pair: chosen.pair ?? chosen.base,
    platformSubagentProfileId: null,
    platformSubagentSettings: null,
  };
  const save = (
    input: Parameters<typeof set.mutateAsync>[0],
  ): Promise<boolean> => {
    setDraft(null);
    return set.mutateAsync(input).then(
      () => true,
      () => false,
    );
  };
  const choose = (
    pair: SessionPair,
    references: SessionChoiceReferences,
    effective = pair,
  ): void | Promise<boolean> => {
    /* UNIT_BOUNDARY_DESCRIPTION: the pick holds no subagent slot of its own: a profile pick that leaves the subagent to the profile saves the reference, so a later edit of the profile reaches new agents; a subagent of its own beside a profile saves the values it runs on, the change materialized. */
    const next = nextSlots(slots, pair, references);
    if (
      next.profileId &&
      !next.platformSubagentProfileId &&
      !next.platformSubagentSettings
    )
      return save({ profileId: next.profileId });
    /* UNIT_BOUNDARY_DESCRIPTION: a subagent change beside a profile may carry no provider of its own; the profile's runs on the Connection the slots already show. */
    const provider = effective.provider ?? slots.pair?.provider ?? null;
    const { model } = effective;
    /* UNIT_BOUNDARY_DESCRIPTION: a harness picked without a model waits in the open picker, since a new agent needs a model to start on. */
    if (provider === null || model === null)
      return setDraft(nextSlots(slots, effective, { profileId: null }));
    return save({ pair: { ...effective, provider, model } });
  };

  return (
    <section className="mb-8 flex flex-col gap-2">
      <SectionLabel>{LABEL}</SectionLabel>
      <p className="text-sm text-muted-foreground">
        A new agent starts with this as its default model. Change an agent’s own
        default on its Providers page.
      </p>
      <SessionPairPicker
        agentId={null}
        carried={status.harnesses}
        defaultHarness={status.defaultHarness}
        routed
        row
        onOpenChange={(open) => {
          if (!open && draft?.pair?.model === null) setDraft(null);
        }}
        onConnectProviders={() => navigateToSettings("providers")}
        target={{
          slots,
          label: LABEL,
          placeholder: "Choose a model",
          onChoose: choose,
        }}
      />
    </section>
  );
}
