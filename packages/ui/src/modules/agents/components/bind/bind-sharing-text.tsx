import { BoldList } from "../../../../components/inline-list.js";
import { SharedChannelsPhrase } from "../../../connections/components/shared-channels-phrase.js";
import type { SharedChannel } from "../../../sandboxes/lib/shared-channels.js";

export function BindSharingText({
  agentName,
  connectionNames,
  audience,
  whisper,
}: {
  agentName: string;
  connectionNames: readonly string[] | null;
  audience: SharedChannel;
  whisper: boolean;
}) {
  const name = (
    <strong className="font-semibold text-foreground">{agentName}</strong>
  );
  const phrase = <SharedChannelsPhrase channels={[audience]} />;
  const whisperText = (
    <>
      Whispers are on: anyone in {phrase} can talk to {name} privately, so
      someone could ask it to change its instructions, memory or settings
      without the others seeing.
    </>
  );
  if (connectionNames?.length === 0) return whisperText;
  const sharing =
    connectionNames === null ? (
      <>
        If {name} has connections, anyone in {phrase} can ask it to use them,
        with your access.
      </>
    ) : (
      <>
        {name} has{" "}
        {connectionNames.length === 1
          ? "1 connection"
          : `${connectionNames.length} connections`}
        : <BoldList items={connectionNames} limit={4} />. Anyone in {phrase} can
        ask it to use {connectionNames.length === 1 ? "it" : "them"}, with your
        access.
      </>
    );
  return whisper ? (
    <>
      {sharing} {whisperText}
    </>
  ) : (
    sharing
  );
}
