import { getBrand } from "../../../../brand.js";
import { ChannelSwitchCard } from "./channel-switch-card.js";

export function WhisperCard({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <ChannelSwitchCard
      label="Whispers"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
    >
      Anyone in the conversation can talk to the agent privately with{" "}
      <code>/{getBrand().short} whisper</code>. Nobody else there sees it, so
      someone could ask the agent to change its instructions, memory or settings
      without the others knowing. You can still read every whisper in the
      agent&apos;s sessions.
    </ChannelSwitchCard>
  );
}
