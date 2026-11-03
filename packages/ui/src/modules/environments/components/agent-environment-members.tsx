import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import { useAgent } from "../../agents/api/queries.js";
import { ViewerListEditor } from "../../artifacts/components/viewer-list-editor.js";
import { sameViewers } from "../../artifacts/lib/viewer-allowlist.js";
import type { SectionHeaderSlot } from "../../sandboxes/components/sandbox-home-header.js";
import { useSetAgentEnvironmentMembers } from "../api/mutations.js";
import { useAgentEnvironmentMembers } from "../api/queries.js";
import {
  AgentMembersEditor,
  sameAgents,
  type ListedAgent,
} from "./agent-members-editor.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Environments section of an agent's page: the
 * agent's Environment Members, who open every Environment it creates, read at
 * each request, and a link to the Artifacts list, where its owner finds,
 * shares, extends and deletes each Environment. An editor has no Artifacts
 * list of the owner's, so the section tells them who holds the Environments
 * instead of sending them to an empty list. The agent sets none of it.
 */
export function AgentEnvironmentsSection({
  agentId,
  header,
}: {
  agentId: string;
  header: SectionHeaderSlot;
}) {
  const setView = useStore((s) => s.setView);
  const owner = useAgent(agentId)?.access.role !== "editor";
  return (
    <>
      {header()}
      <AgentEnvironmentMembers key={agentId} agentId={agentId} />
      {owner ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="environments-in-artifacts"
        >
          The agent&apos;s Environments are in{" "}
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => setView("artifacts")}
          >
            Artifacts
          </button>
          , where you open, share, extend and delete each one.
        </p>
      ) : (
        <p
          className="text-sm text-muted-foreground"
          data-testid="environments-with-owner"
        >
          The agent&apos;s owner opens, shares, extends and deletes each of its
          Environments in their Artifacts list. You open every one as a member
          of this list does.
        </p>
      )}
    </>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The agent's Environment Members: people, by the
 * email they sign in with, and Agents of any owner, by their id. The owner and the agent's editors always may open its
 * Environments; the owner adds a person to one Environment in its Share
 * dialog. The list is edited only once it loaded, so a Save never replaces a
 * list the page could not read, and its edits belong to one agent: moving to
 * another agent starts the editor afresh.
 */
function AgentEnvironmentMembers({ agentId }: { agentId: string }) {
  const saved = useAgentEnvironmentMembers(agentId);
  const save = useSetAgentEnvironmentMembers();
  const [edited, setEdited] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editedAgents, setEditedAgents] = useState<ListedAgent[] | null>(null);
  const [agentDraft, setAgentDraft] = useState("");

  return (
    <div className="mb-6 flex flex-col gap-2" data-testid="environment-access">
      <SectionLabel>Environment members</SectionLabel>
      <p className="text-sm text-muted-foreground">
        They open every Environment this agent creates, signed in with this
        email, as you and the agent&apos;s editors do. Only people change this
        list; the agent cannot.
      </p>
      {saved.data === undefined ? (
        <p className="text-sm text-muted-foreground">
          {saved.isError ? "Couldn't load the list." : "Loading…"}
        </p>
      ) : (
        <MembersForm
          savedEmails={saved.data.emails}
          savedAgents={saved.data.agents}
          edited={edited}
          setEdited={setEdited}
          editedAgents={editedAgents}
          setEditedAgents={setEditedAgents}
          draft={draft}
          setDraft={setDraft}
          agentDraft={agentDraft}
          setAgentDraft={setAgentDraft}
          saving={save.isPending}
          onSave={(emails, agentIds) =>
            save.mutate(
              { owningAgentId: agentId, emails, agentIds },
              {
                onSuccess: () => {
                  setEdited(null);
                  setEditedAgents(null);
                },
              },
            )
          }
        />
      )}
    </div>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the loaded list, its edits and their Save. The shared editor says how full the list is, and the empty list says who may open them without it.
function MembersForm({
  savedEmails,
  savedAgents,
  edited,
  setEdited,
  editedAgents,
  setEditedAgents,
  draft,
  setDraft,
  agentDraft,
  setAgentDraft,
  saving,
  onSave,
}: {
  savedEmails: string[];
  savedAgents: ListedAgent[];
  edited: string[] | null;
  setEdited: (emails: string[] | null) => void;
  editedAgents: ListedAgent[] | null;
  setEditedAgents: (agents: ListedAgent[] | null) => void;
  draft: string;
  setDraft: (draft: string) => void;
  agentDraft: string;
  setAgentDraft: (draft: string) => void;
  saving: boolean;
  onSave: (emails: string[], agentIds: string[]) => void;
}) {
  const emails = edited ?? savedEmails;
  const agents = editedAgents ?? savedAgents;
  const dirty =
    (edited !== null && !sameViewers(edited, savedEmails)) ||
    (editedAgents !== null && !sameAgents(editedAgents, savedAgents));

  return (
    <>
      <ViewerListEditor
        viewers={emails}
        onChange={setEdited}
        disabled={saving}
        draft={draft}
        onDraftChange={setDraft}
        inputLabel="Member email address"
        {...(emails.length === 0 && {
          caption:
            "Only you and the agent's editors can open this agent's Environments.",
        })}
      />
      <p className="mt-2 text-sm font-medium text-foreground">Agents</p>
      <p className="text-xs text-muted-foreground">
        An agent named here opens every Environment this agent creates, from
        its own sandbox, as itself — another user&apos;s too. This agent always
        opens its own.
      </p>
      <AgentMembersEditor
        agents={agents}
        onChange={setEditedAgents}
        disabled={saving}
        draft={agentDraft}
        onDraftChange={setAgentDraft}
      />
      {dirty && (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={saving}
            onClick={() => onSave(emails, agents.map((a) => a.agentId))}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setEdited(null);
              setEditedAgents(null);
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </>
  );
}
