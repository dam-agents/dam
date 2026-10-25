import type { ReactNode } from "react";

import { BoldList } from "../../../components/inline-list.js";
import type { ConnectionAudience } from "../lib/connection-audience.js";
import { SharedChannelsPhrase } from "./shared-channels-phrase.js";

const NAMED_EDITORS_LIMIT = 3;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one sentence that tells an owner who else
 * can ask an agent to use a connection, with the owner's access: the Agent
 * Editors by email, and everyone in the channels it is bound to. The warning
 * on adding a connection, the catalog and Connections page notices, and the
 * secret page all say it the same way.
 */
export function ConnectionAudienceSentence({
  audience: { editors, channels },
  uses,
  agentName,
}: {
  audience: ConnectionAudience;
  uses: ReactNode;
  agentName?: string;
}) {
  const agent = agentName ? (
    <strong className="font-semibold text-foreground">{agentName}</strong>
  ) : (
    "this agent"
  );
  const Agent = agentName ? agent : "This agent";
  const named = editors.length > 0 && (
    <>
      {editors.length === 1 ? "Editor" : "Editors"}{" "}
      <BoldList items={editors} limit={NAMED_EDITORS_LIMIT} />
    </>
  );
  if (channels === null)
    return named ? (
      <>
        {named} can ask {agent} to use {uses}, with your access. If it is bound
        to a Slack channel or a group chat, anyone there can too.
      </>
    ) : (
      <>
        If {agent} is bound to a Slack channel or a group chat, anyone there can
        ask it to use {uses}, with your access.
      </>
    );
  if (channels.length === 0)
    return (
      named && (
        <>
          {named} can ask {agent} to use {uses}, with your access.
        </>
      )
    );
  const phrase = <SharedChannelsPhrase channels={channels} />;
  if (!named)
    return (
      <>
        {Agent} is bound to {phrase}. Anyone there can ask it to use {uses},
        with your access.
      </>
    );
  return (
    <>
      {named}, and anyone in {phrase}, can ask {agent} to use {uses}, with your
      access.
    </>
  );
}
