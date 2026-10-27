import type { AgentAccess } from "api-server-api";
import { useState } from "react";
import { match } from "ts-pattern";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

import { getUser } from "../../../auth.js";
import type { AgentView } from "../../../types.js";
import { useSetAgentEditors } from "../../agents/api/mutations.js";
import { ConnectionNamesTooltip } from "../../agents/components/connection-names-tooltip.js";
import { OwnerOnlyNotice } from "../../agents/components/owner-only-notice.js";
import { useActingConnectionNames } from "../../agents/hooks/use-acting-connection-names.js";
import { editorsWarning } from "../../agents/lib/agent-editors.js";
import { ViewerListEditor } from "../../artifacts/components/viewer-list-editor.js";
import { sameViewers } from "../../artifacts/lib/viewer-allowlist.js";
import { useAgentManagement } from "../hooks/use-agent-management.js";

type EditorAccess = Extract<AgentAccess, { role: "editor" }>;

const signedInEmail = () => getUser()?.profile.email?.trim().toLowerCase();

/**
 * UNIT_BOUNDARY_DESCRIPTION: Who works on an agent: its owner, then its
 * Agent Editors. The owner changes the Editor List here and always sees what
 * an editor can do before saving. An editor sees the same people, and can
 * take only themselves off the list.
 */
export function PeopleSection({ agent }: { agent: AgentView }) {
  return match(agent.access)
    .with({ role: "owner" }, ({ editors }) => (
      <OwnerPeople key={agent.id} agentId={agent.id} editors={editors} />
    ))
    .with({ role: "editor" }, (access) => (
      <EditorPeople agent={agent} access={access} />
    ))
    .exhaustive();
}

function OwnerPeople({
  agentId,
  editors,
}: {
  agentId: string;
  editors: string[];
}) {
  const ownEmail = signedInEmail();
  const warning = editorsWarning(useActingConnectionNames(agentId) ?? []);
  return (
    <section className="mb-8 flex flex-col gap-4" data-testid="agent-people">
      <div className="flex flex-col gap-2">
        <SectionLabel>Owner</SectionLabel>
        <p className="text-sm text-foreground">
          {ownEmail ? `you (${ownEmail})` : "you"}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <SectionLabel>Editors</SectionLabel>
        <EditorListForm agentId={agentId} saved={editors} />
      </div>
      <ConnectionNamesTooltip connections={warning.connections}>
        <Callout
          tone="warning"
          size="sm"
          role="note"
          className="text-xs"
          tabIndex={warning.connections?.more ? 0 : undefined}
          data-testid="agent-editors-warning"
        >
          {warning.text}
        </Callout>
      </ConnectionNamesTooltip>
    </section>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the Editor List as saved, the owner's edits to it, and their Save. An email typed but not yet added keeps Save off, so the owner never saves a list without the person they meant to add.
function EditorListForm({
  agentId,
  saved,
}: {
  agentId: string;
  saved: string[];
}) {
  const save = useSetAgentEditors();
  const [edited, setEdited] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const emails = edited ?? saved;
  const dirty = edited !== null && !sameViewers(edited, saved);

  return (
    <>
      <ViewerListEditor
        viewers={emails}
        onChange={setEdited}
        disabled={save.isPending}
        draft={draft}
        onDraftChange={setDraft}
        inputLabel="Editor email address"
        {...(emails.length === 0 && {
          caption:
            "Only you can change this agent. Add people to let them help.",
        })}
      />
      {dirty && (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={save.isPending || draft.trim().length > 0}
            onClick={() =>
              save.mutate(
                { id: agentId, editors: emails },
                { onSuccess: () => setEdited(null) },
              )
            }
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => setEdited(null)}
          >
            Cancel
          </Button>
        </div>
      )}
    </>
  );
}

function EditorPeople({
  agent,
  access,
}: {
  agent: AgentView;
  access: EditorAccess;
}) {
  const ownEmail = signedInEmail();
  const management = useAgentManagement();

  return (
    <section className="mb-8 flex flex-col gap-4" data-testid="agent-people">
      <OwnerOnlyNotice
        title="Only the owner adds and removes editors."
        testId="people-owner-only"
      >
        You can leave this agent yourself.
      </OwnerOnlyNotice>
      <div className="flex flex-col gap-2">
        <SectionLabel>Owner</SectionLabel>
        <p className="text-sm text-foreground">
          {access.ownerEmail ?? "A former user"}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <SectionLabel>Editors</SectionLabel>
        <ul className="-ml-1 pr-1" data-testid="agent-editor-list">
          {access.editors.map((email) => (
            <li
              key={email}
              className="flex h-9 items-center justify-between gap-2 rounded-md pl-1"
            >
              <span className="truncate text-sm text-foreground">
                {email === ownEmail ? `you (${email})` : email}
              </span>
              {email === ownEmail && (
                <Button
                  size="sm"
                  variant="ghost"
                  tone="danger"
                  disabled={management.leaving}
                  onClick={() => void management.leave(agent)}
                >
                  Leave
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
