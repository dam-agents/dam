import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import { ViewerListEditor } from "../../artifacts/components/viewer-list-editor.js";
import { sameViewers } from "../../artifacts/lib/viewer-allowlist.js";
import type { SectionHeaderSlot } from "../../sandboxes/components/sandbox-home-header.js";
import { useSetAgentEnvironmentMembers } from "../api/mutations.js";
import { useAgentEnvironmentMembers } from "../api/queries.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Environments section of an agent's page: the
 * agent's Environment Members, who open every Environment it creates, read at
 * each request, and a link to the Artifacts list, where its owner finds,
 * shares, extends and deletes each Environment. The agent sets none of it.
 */
export function AgentEnvironmentsSection({
  agentId,
  header,
}: {
  agentId: string;
  header: SectionHeaderSlot;
}) {
  const setView = useStore((s) => s.setView);
  return (
    <>
      {header()}
      <AgentEnvironmentMembers key={agentId} agentId={agentId} />
      <p className="text-sm text-muted-foreground" data-testid="environments-in-artifacts">
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
    </>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The agent's Environment Members, by the email
 * they sign in with. The owner and the agent's editors always may open its
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
          savedEmails={saved.data}
          edited={edited}
          setEdited={setEdited}
          draft={draft}
          setDraft={setDraft}
          saving={save.isPending}
          onSave={(emails) =>
            save.mutate(
              { owningAgentId: agentId, emails },
              { onSuccess: () => setEdited(null) },
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
  edited,
  setEdited,
  draft,
  setDraft,
  saving,
  onSave,
}: {
  savedEmails: string[];
  edited: string[] | null;
  setEdited: (emails: string[] | null) => void;
  draft: string;
  setDraft: (draft: string) => void;
  saving: boolean;
  onSave: (emails: string[]) => void;
}) {
  const emails = edited ?? savedEmails;
  const dirty = edited !== null && !sameViewers(edited, savedEmails);

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
      {dirty && (
        <div className="flex gap-2">
          <Button size="sm" disabled={saving} onClick={() => onSave(emails)}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => setEdited(null)}
          >
            Cancel
          </Button>
        </div>
      )}
    </>
  );
}
