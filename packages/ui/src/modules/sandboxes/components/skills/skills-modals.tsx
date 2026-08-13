import type { LocalSkill, Skill, SkillSource } from "api-server-api";

import type { SkillsDerivations } from "../../hooks/use-skills-derivations.js";
import type { SkillsSurface } from "../../hooks/use-skills-surface.js";
import { AddSkillSetsModal } from "./add-skill-sets-modal.js";
import { AddSkillSourceModal } from "./add-skill-source-modal.js";
import { LocalSkillRenderModal } from "./local-skill-render-modal.js";
import { PublishSkillModal } from "./publish-skill-modal.js";
import { SaveSkillSetModal } from "./save-skill-set-modal.js";
import { SkillRenderModal } from "./skill-render-modal.js";

export type SkillsModal =
  | { kind: "add-source"; tab: "github" | "upload"; files: File[] }
  | { kind: "publish"; skill: LocalSkill }
  | { kind: "render"; source: SkillSource; skill: Skill }
  | { kind: "render-local"; skill: LocalSkill }
  | { kind: "save-set" }
  | { kind: "add-sets" };

export function SkillsModals({
  open,
  agentId,
  surface,
  derived,
  onClose,
}: {
  open: SkillsModal | null;
  agentId: string | null;
  surface: SkillsSurface;
  derived: SkillsDerivations;
  onClose: () => void;
}) {
  if (!open) return null;

  switch (open.kind) {
    case "add-source":
      return (
        <AddSkillSourceModal
          onClose={onClose}
          onCreate={surface.createSource}
          onCreateSkills={surface.createLocalSkills}
          initialTab={open.tab}
          initialFiles={open.files}
        />
      );

    case "add-sets":
      return (
        <AddSkillSetsModal
          sets={surface.sets}
          loadFailed={surface.setsFailed}
          available={derived.availableKeys}
          installedKeys={derived.installedKeys}
          unreadableSources={derived.unreadableSources}
          ready={derived.previewReady}
          applying={surface.applyingSets}
          onApply={surface.applySets}
          onDelete={surface.deleteSet}
          onClose={onClose}
        />
      );

    case "save-set":
      return (
        <SaveSkillSetModal
          groups={derived.setGroups}
          omitted={derived.saveOmitted}
          isOn={(skill) =>
            surface.installedRef(skill.source, skill.name) !== undefined
          }
          existingNames={derived.existingSetNames}
          onCreate={surface.createSet}
          onClose={onClose}
        />
      );

    case "publish":
      return (
        <PublishSkillModal
          skill={open.skill}
          sources={derived.publishableSources}
          onPublish={surface.publish}
          onClose={onClose}
        />
      );

    case "render":
      return (
        <SkillRenderModal
          source={open.source}
          skill={open.skill}
          agentId={agentId}
          onClose={onClose}
        />
      );

    case "render-local":
      if (!agentId) return null;
      return (
        <LocalSkillRenderModal
          skill={open.skill}
          agentId={agentId}
          onClose={onClose}
        />
      );
    default: {
      const unhandled: never = open;
      return unhandled;
    }
  }
}
