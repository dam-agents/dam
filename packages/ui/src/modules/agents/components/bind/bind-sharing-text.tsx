import { BoldList } from "../../../../components/inline-list.js";
import { SharedChannelsPhrase } from "../../../connections/components/shared-channels-phrase.js";
import type { SharedChannel } from "../../../sandboxes/lib/shared-channels.js";

export function BindSharingText({
  agentName,
  connectionNames,
  audience,
}: {
  agentName: string;
  connectionNames: readonly string[] | null;
  audience: SharedChannel;
}) {
  const name = (
    <strong className="font-semibold text-foreground">{agentName}</strong>
  );
  const phrase = <SharedChannelsPhrase channels={[audience]} />;
  if (connectionNames === null)
    return (
      <>
        If {name} has connections, anyone in {phrase} can ask it to use them,
        with your access.
      </>
    );
  const one = connectionNames.length === 1;
  return (
    <>
      {name} has{" "}
      {one ? "1 connection" : `${connectionNames.length} connections`}:{" "}
      <BoldList items={connectionNames} limit={4} />. Anyone in {phrase} can ask
      it to use {one ? "it" : "them"}, with your access.
    </>
  );
}
