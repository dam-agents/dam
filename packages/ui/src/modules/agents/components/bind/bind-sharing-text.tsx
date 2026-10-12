import { BoldList } from "../../../../components/inline-list.js";
import { SharedChannelsPhrase } from "../../../connections/components/shared-channels-phrase.js";
import type { SharedChannel } from "../../../sandboxes/lib/shared-channels.js";

export function BindSharingText({
  agentName,
  connectionNames,
  audience,
}: {
  agentName: string;
  connectionNames: readonly string[];
  audience: SharedChannel;
}) {
  const one = connectionNames.length === 1;
  return (
    <>
      <strong className="font-semibold text-foreground">{agentName}</strong> has{" "}
      {one ? "1 connection" : `${connectionNames.length} connections`}:{" "}
      <BoldList items={connectionNames} limit={4} />. Anyone in{" "}
      <SharedChannelsPhrase channels={[audience]} /> can ask it to use{" "}
      {one ? "it" : "them"}, with your access.
    </>
  );
}
