import { isPlatformSubagentSetting } from "agent-runtime-api";
import type {
  SessionChoiceReferences,
  SessionChoiceSlots,
  SessionPair,
} from "api-server-api";
import { useState } from "react";

import { useStore } from "../../../../store.js";
import { useHarnessConfigStatus } from "../../../agents/api/harness-config.js";
import { SessionPairPicker } from "../../../sessions/components/session-pair-picker.js";
import { nextSlots } from "../../../sessions/lib/subagent-choice.js";
import { useSetChannelChoice } from "../../api/channel-profile.js";

export type ChannelKey = {
  type: "slack" | "telegram";
  slackChannelId?: string;
  conversationId?: string;
};

/** UNIT_BOUNDARY_DESCRIPTION: a pick made before the channel exists: the slots the picker shows and the request that stores them once it is bound. */
export interface ChannelPick {
  slots: SessionChoiceSlots;
  request: { pair: SessionPair | null } & SessionChoiceReferences;
}

export const NO_CHOICE: SessionChoiceSlots = {
  profileId: null,
  pair: null,
  platformSubagentProfileId: null,
  platformSubagentSettings: null,
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a channel's turns run on, picked with the
 * chat's own picker in both slots; neither primary slot set follows the
 * agent's chat default. A pick answers the slots it leaves and the request
 * that stores them, both slots named so nothing is left to the server's guess.
 */
export function ChannelChoicePicker({
  agentId,
  slots,
  readOnly = false,
  onChoose,
}: {
  agentId: string;
  slots: SessionChoiceSlots;
  readOnly?: boolean;
  onChoose: (
    next: SessionChoiceSlots,
    request: { pair: SessionPair } & SessionChoiceReferences,
  ) => void;
}) {
  const { data: status } = useHarnessConfigStatus(agentId);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  return (
    <fieldset disabled={readOnly} className="min-w-0">
      <SessionPairPicker
        agentId={agentId}
        carried={status?.harnesses ?? []}
        defaultHarness={status?.defaultHarness ?? ""}
        routed={status?.modelRouter ?? false}
        onConnectProviders={() => navigateToSandboxHome(agentId, "providers")}
        target={{
          slots,
          label: "Channel harness and model",
          placeholder: "The agent's chat default",
          onChoose: (pair, references) => {
            const next = nextSlots(slots, pair, references);
            /* UNIT_BOUNDARY_DESCRIPTION: the request carries the subagent values the slots keep, since a primary pick may hand back a pair without them. */
            const settings = {
              ...Object.fromEntries(
                Object.entries(pair.settings ?? {}).filter(
                  ([id]) => !isPlatformSubagentSetting(id),
                ),
              ),
              ...next.platformSubagentSettings,
            };
            onChoose(next, {
              pair: { ...pair, settings },
              profileId: next.profileId,
              platformSubagentProfileId: next.platformSubagentProfileId,
            });
          },
        }}
      />
    </fieldset>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: a bound channel's pick on its own row (D91), stored as it is made; a harness picked without a model is held here until its model is, since a routed save refuses it. */
export function ChannelProfileLine({
  agentId,
  channel,
  slots,
  readOnly = false,
}: {
  agentId: string;
  channel: ChannelKey;
  slots: SessionChoiceSlots;
  readOnly?: boolean;
}) {
  const setChoice = useSetChannelChoice(agentId);
  const [draft, setDraft] = useState<SessionChoiceSlots | null>(null);
  return (
    <ChannelChoicePicker
      agentId={agentId}
      slots={draft ?? slots}
      readOnly={readOnly || setChoice.isPending}
      onChoose={(next, request) => {
        if (!request.profileId && !request.pair.model) return setDraft(next);
        setDraft(null);
        setChoice.mutate({ ...channel, ...request });
      }}
    />
  );
}
