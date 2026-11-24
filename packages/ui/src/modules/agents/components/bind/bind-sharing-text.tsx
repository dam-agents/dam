import { BoldList } from "../../../../components/inline-list.js";
import { SharedChannelsPhrase } from "../../../connections/components/shared-channels-phrase.js";
import type { SharedChannel } from "../../../sandboxes/lib/shared-channels.js";
import type { SharedAccessChoice } from "../../hooks/use-agent-shared-access.js";

function AccessChoiceText({
  choices,
}: {
  choices: readonly SharedAccessChoice[];
}) {
  const named = (access: SharedAccessChoice["access"]) =>
    choices.filter((c) => c.access === access).map((c) => c.name);
  const readOnly = named("read-only");
  const full = named("full");
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
  accessChoices = [],
  audience,
  whisper,
}: {
  agentName: string;
  connectionNames: readonly string[] | null;
  accessChoices?: readonly SharedAccessChoice[];
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
        <AccessChoiceText choices={accessChoices} />
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
