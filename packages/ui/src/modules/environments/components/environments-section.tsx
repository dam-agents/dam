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
      <AccessListEditor agentId={agentId} />
      <ListSection
        label="Environments"
        loading={environments.isPending}
        error={environments.isError && "Couldn't load Environments."}
        isEmpty={list.length === 0}
        empty="No Environments yet. The agent creates one with its create_environment tool, for example to run a pull request's build for you to open."
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
 * the agent may narrow the list for one Environment, never add to it.
 */
function AccessListEditor({ agentId }: { agentId: string }) {
  const saved = useEnvironmentAccessList(agentId);
  const save = useSetEnvironmentAccessList();
  const [edited, setEdited] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const savedEmails = saved.data ?? [];
  const emails = edited ?? savedEmails;
  const dirty = edited !== null && !sameViewers(edited, savedEmails);

  return (
    <div className="mb-6 flex flex-col gap-2" data-testid="environment-access">
      <SectionLabel>Who may open them</SectionLabel>
      <p className="text-sm text-muted-foreground">
        You always may. Add the people who review this agent's work; they sign
        in with this email. The agent can narrow the list for one Environment,
        never add to it.
      </p>
      <ViewerListEditor
        viewers={emails}
        onChange={setEdited}
        disabled={saved.isPending || save.isPending}
        draft={draft}
        onDraftChange={setDraft}
        caption={
          emails.length === 0
            ? "Only you can open this agent's Environments."
            : `${emails.length} people may open this agent's Environments.`
        }
      />
      {dirty && (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                { owningAgentId: agentId, emails },
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
    </div>
  );
}
