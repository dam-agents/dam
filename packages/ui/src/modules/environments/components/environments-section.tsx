import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ListSection } from "@/components/ui/list-section";
import { SectionLabel } from "@/components/ui/section-label";

import { ViewerListEditor } from "../../artifacts/components/viewer-list-editor.js";
import { sameViewers } from "../../artifacts/lib/viewer-allowlist.js";
import type { SectionHeaderSlot } from "../../sandboxes/components/sandbox-home-header.js";
import { useSetEnvironmentAccessList } from "../api/mutations.js";
import { useEnvironmentAccessList, useEnvironments } from "../api/queries.js";
import { EnvironmentCard } from "./environment-card.js";

export const NO_ENVIRONMENTS =
  "No Environments yet. The agent creates one with its create_environment tool, for example to run a pull request's build for you to open.";

/**
 * UNIT_BOUNDARY_DESCRIPTION: An agent's Environments, which the agent creates
 * and controls, and the owner's controls over them: the list of people who may
 * open any of them, and each Environment's card. The owner creates none here;
 * the agent does, with its tools.
 */
export function EnvironmentsSection({
  agentId,
  header,
}: {
  agentId: string;
  header: SectionHeaderSlot;
}) {
  const environments = useEnvironments(agentId);
  const list = environments.data ?? [];

  return (
    <>
      {header()}
      <AccessListEditor key={agentId} agentId={agentId} />
      <ListSection
        label="Environments"
        loading={environments.isPending}
        error={environments.isError && "Couldn't load Environments."}
        isEmpty={list.length === 0}
        empty={NO_ENVIRONMENTS}
        separated
      >
        {list.map((environment) => (
          <EnvironmentCard key={environment.id} environment={environment} />
        ))}
      </ListSection>
    </>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The owner's list of people who may open this
 * agent's Environments, by the email they sign in with. The owner always may;
 * the agent may narrow the list for one Environment, never add to it. The
 * list is edited only once it loaded, so a Save never replaces a list the
 * page could not read, and its edits belong to one agent: moving to another
 * agent starts the editor afresh.
 */
export function AccessListEditor({ agentId }: { agentId: string }) {
  const saved = useEnvironmentAccessList(agentId);
  const save = useSetEnvironmentAccessList();
  const [edited, setEdited] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <div className="mb-6 flex flex-col gap-2" data-testid="environment-access">
      <SectionLabel>Who may open them</SectionLabel>
      <p className="text-sm text-muted-foreground">
        You always may. Add the people who review this agent's work; they sign
        in with this email. The agent can narrow the list for one Environment,
        never add to it.
      </p>
      {saved.data === undefined ? (
        <p className="text-sm text-muted-foreground">
          {saved.isError ? "Couldn't load the list." : "Loading…"}
        </p>
      ) : (
        <ListForm
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

// UNIT_BOUNDARY_DESCRIPTION: the loaded list, its edits and their Save. The shared editor says how full the list is, and the empty list says that only the owner may open them.
function ListForm({
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
        {...(emails.length === 0 && {
          caption: "Only you can open this agent's Environments.",
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
