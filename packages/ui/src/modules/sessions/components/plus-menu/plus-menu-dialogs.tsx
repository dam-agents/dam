import { match } from "ts-pattern";

import { ConnectionCatalogModal } from "../../../connections/components/connection-catalog-modal.js";
import { routeToPath } from "../../../platform/lib/routes.js";
import { AddSkillSourceModal } from "../../../sandboxes/components/skills/add-skill-source-modal.js";
import { useAgentConnectionGrants } from "../../../sandboxes/hooks/use-agent-connection-grants.js";
import { useSkillsSurface } from "../../../sandboxes/hooks/use-skills-surface.js";
import { ScheduleFormModal } from "../../../schedules/forms/schedule-form-modal.js";
import type { PlusMenuDialog } from "../../lib/plus-menu.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The create flows the composer's + menu opens
 * once it has closed: the existing dialogs that add a skill source, a
 * schedule, or a Connection the Agent then holds. Each one is the dialog the
 * Agent's settings open for the same add.
 */
export function PlusMenuDialogs({
  agentId,
  dialog,
  onClose,
}: {
  agentId: string;
  dialog: PlusMenuDialog;
  onClose: () => void;
}) {
  return match(dialog)
    .with("add-skill-source", () => (
      <AddSkillSourceDialog agentId={agentId} onClose={onClose} />
    ))
    .with("add-schedule", () => (
      <ScheduleFormModal agentId={agentId} onClose={onClose} />
    ))
    .with("add-connection", () => (
      <AddConnectionDialog agentId={agentId} onClose={onClose} />
    ))
    .exhaustive();
}

function AddSkillSourceDialog({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const surface = useSkillsSurface(agentId, {
    readOnly: false,
    isError: false,
  });
  return (
    <AddSkillSourceModal
      sources={surface.sources}
      hiddenSources={surface.hiddenSources}
      onShowSource={(id) => surface.setSourceHidden(id, false)}
      onClose={onClose}
      onCreate={surface.createSource}
      onCreateSkills={surface.createLocalSkills}
      mode="github"
    />
  );
}

function AddConnectionDialog({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const grants = useAgentConnectionGrants(agentId);
  return (
    <ConnectionCatalogModal
      onClose={onClose}
      sandbox={{
        grantedIds: grants.grantedIds,
        onToggleGrant: grants.toggleGrant,
        onRevoke: grants.revokeGrants,
      }}
      sharing={grants.sharing}
      oauthReturnView={routeToPath({ view: "chat", agent: agentId })}
    />
  );
}
