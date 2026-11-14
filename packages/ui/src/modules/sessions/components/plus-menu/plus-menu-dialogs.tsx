import { match } from "ts-pattern";

import { ConnectionCatalogModal } from "../../../connections/components/connection-catalog-modal.js";
import { routeToPath } from "../../../platform/lib/routes.js";
import { AddSkillSourceModal } from "../../../sandboxes/components/skills/add-skill-source-modal.js";
import {
  type SkillsModal,
  SkillsModals,
} from "../../../sandboxes/components/skills/skills-modals.js";
import { useAgentConnectionGrants } from "../../../sandboxes/hooks/use-agent-connection-grants.js";
import { useSkillsConfirms } from "../../../sandboxes/hooks/use-skills-confirms.js";
import { useSkillsDerivations } from "../../../sandboxes/hooks/use-skills-derivations.js";
import { useSkillsSurface } from "../../../sandboxes/hooks/use-skills-surface.js";
import { ScheduleFormModal } from "../../../schedules/forms/schedule-form-modal.js";
import type { PlusMenuDialog } from "../../lib/plus-menu.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The dialogs the composer's + menu opens once it
 * has closed, so none is drawn under the menu or dismissed with it: the
 * existing dialogs that add a skill source, a schedule, or a Connection the
 * Agent then holds, and the editor of a listed schedule. Each one is the dialog the
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
    .with({ kind: "add-skill-source" }, () => (
      <AddSkillSourceDialog agentId={agentId} onClose={onClose} />
    ))
    .with({ kind: "add-schedule" }, () => (
      <ScheduleFormModal agentId={agentId} onClose={onClose} />
    ))
    .with({ kind: "edit-schedule" }, ({ schedule }) => (
      <ScheduleFormModal
        agentId={schedule.agentId}
        existing={schedule}
        onClose={onClose}
      />
    ))
    .with({ kind: "skills" }, ({ modal }) => (
      <SkillsModalDialog agentId={agentId} modal={modal} onClose={onClose} />
    ))
    .with({ kind: "add-connection" }, () => (
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

/* UNIT_BOUNDARY_DESCRIPTION: a dialog the compact Skills list asked for — a skill's preview, or the upload a dropped file starts — drawn with the Agent's own skills state, as the Skills section draws it. */
function SkillsModalDialog({
  agentId,
  modal,
  onClose,
}: {
  agentId: string;
  modal: SkillsModal;
  onClose: () => void;
}) {
  const surface = useSkillsSurface(agentId, {
    readOnly: false,
    isError: false,
  });
  const derived = useSkillsDerivations(surface, { readOnly: false, query: "" });
  const { deleteStandaloneWithConfirm } = useSkillsConfirms(surface, derived);
  return (
    <SkillsModals
      open={modal}
      agentId={agentId}
      surface={surface}
      derived={derived}
      onDeleteLocal={(skill, pub) =>
        void deleteStandaloneWithConfirm(skill, pub)
      }
      onClose={onClose}
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
