import type {
  LocalSkill,
  Skill,
  SkillPublishRecord,
  SkillSource,
} from "api-server-api";

import { Button } from "@/components/ui/button";

import type { SkillsDerivations } from "../../hooks/use-skills-derivations.js";
import type { SkillsSurface } from "../../hooks/use-skills-surface.js";
import { AddSkillSetsModal } from "./add-skill-sets-modal.js";
import { AddSkillSourceModal } from "./add-skill-source-modal.js";
import { LocalSkillRenderModal } from "./local-skill-render-modal.js";
import { PublishSkillModal } from "./publish-skill-modal.js";
import { SaveSkillSetModal } from "./save-skill-set-modal.js";
import { isDrifted } from "./skill-drift.js";
import { SkillRenderModal } from "./skill-render-modal.js";

function latestPublish(
  publishes: SkillPublishRecord[],
  name: string,
): SkillPublishRecord | undefined {
  let latest: SkillPublishRecord | undefined;
  for (const p of publishes) {
    if (p.skillName !== name) continue;
    if (!latest || p.publishedAt > latest.publishedAt) latest = p;
  }
  return latest;
}

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
  onPublish,
  onDeleteLocal,
  onClose,
}: {
  open: SkillsModal | null;
  agentId: string | null;
  surface: SkillsSurface;
  derived: SkillsDerivations;
  onPublish: (skill: LocalSkill) => void;
  onDeleteLocal: (skill: LocalSkill, publish?: SkillPublishRecord) => void;
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

    case "render": {
      const ref = surface.installedRef(open.skill.source, open.skill.name);
      return (
        <SkillRenderModal
          source={open.source}
          skill={open.skill}
          agentId={agentId}
          visibility={surface.visibilityBySource[open.source.id]}
          installed={ref !== undefined}
          hasDrift={isDrifted(ref, open.skill)}
          disabled={surface.mutationsDisabled}
          onToggle={() => surface.toggle(open.skill)}
          onUpdate={() => void surface.update(open.skill)}
          onClose={onClose}
        />
      );
    }

    case "render-local": {
      if (!agentId) return null;
      const skill = open.skill;
      const publish = latestPublish(surface.publishes, skill.name);
      const createdHere = skill.origin === undefined || skill.origin === "user";
      const canRepublish = !publish || publish.prState === "closed";
      const canPublish = derived.publishableSources.length > 0;
      return (
        <LocalSkillRenderModal
          skill={skill}
          agentId={agentId}
          publish={publish}
          onDownload={() => void surface.downloadStandalone(skill)}
          footer={
            createdHere ? (
              <>
                {canRepublish && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canPublish}
                    tooltip={
                      canPublish
                        ? undefined
                        : "Add a GitHub source first to publish there"
                    }
                    onClick={() => {
                      onClose();
                      onPublish(skill);
                    }}
                  >
                    {publish ? "Publish again…" : "Publish…"}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger-light hover:text-danger"
                  onClick={() => {
                    onClose();
                    onDeleteLocal(skill, publish);
                  }}
                >
                  Delete skill
                </Button>
              </>
            ) : undefined
          }
          onClose={onClose}
        />
      );
    }
    default: {
      const unhandled: never = open;
      return unhandled;
    }
  }
}
