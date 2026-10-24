import { getBrand } from "../../../../brand.js";
import type { AgentView } from "../../../../types.js";
import { useSetWhisper } from "../../../agents/api/mutations.js";
import { holds } from "../../../agents/lib/agent-permissions.js";
import { ChannelSwitchCard } from "./channel-switch-card.js";

export function WhisperCard({ agent }: { agent: AgentView }) {
  const update = useSetWhisper();
  const checked =
    (update.isPending ? update.variables.whisper : undefined) ?? agent.whisper;
  return (
    <ChannelSwitchCard
      label="Whispers"
      checked={checked}
      onChange={(whisper) => update.mutate({ id: agent.id, whisper })}
      disabled={update.isPending || !holds(agent.access, "channels")}
    >
      Anyone in a conversation this agent is connected to can talk to it
      privately with <code>/{getBrand().short} whisper</code>. Nobody else there
      sees it, so someone could ask the agent to change its instructions, memory
      or settings without the others knowing. You can still read every whisper
      in the agent&apos;s sessions.
    </ChannelSwitchCard>
  );
}
