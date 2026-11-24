import { BoldList } from "../../../../components/inline-list.js";
import { SharedChannelsPhrase } from "../../../connections/components/shared-channels-phrase.js";
import type { SharedChannel } from "../../../sandboxes/lib/shared-channels.js";
import type { SharedToolAccess } from "../../hooks/use-agent-shared-access.js";

function ToolAccessText({
  connections,
}: {
  connections: readonly SharedToolAccess[];
}) {
  const named = (reach: SharedToolAccess["reach"]) =>
    connections.filter((c) => c.reach === reach).map((c) => c.name);
  const readOnly = named("reads");
  const approval = named("asks");
  const full = named("writes");
  return (
    <>
      {readOnly.length > 0 && (
        <>
          {" "}
          <BoldList items={readOnly} limit={4} />{" "}
          {readOnly.length === 1 ? "is" : "are"} read only: through{" "}
          {readOnly.length === 1 ? "it" : "them"} they can read what you can
          read, and change nothing.
        </>
      )}
      {approval.length > 0 && (
        <>
          {" "}
          Through <BoldList items={approval} limit={4} /> they can read what you
          can read, and every other tool call waits until someone approves it.
        </>
      )}
      {full.length > 0 && (
        <>
          {" "}
          Through <BoldList items={full} limit={4} /> they can also post and
          change things as you.
        </>
      )}
    </>
  );
}

export function BindSharingText({
  agentName,
  connectionNames,
  toolAccess = [],
  audience,
  whisper,
}: {
  agentName: string;
  connectionNames: readonly string[] | null;
  toolAccess?: readonly SharedToolAccess[];
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
        <ToolAccessText connections={toolAccess} />
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
