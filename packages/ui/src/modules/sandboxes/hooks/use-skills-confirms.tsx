import type {
  LocalSkill,
  Skill,
  SkillPublishRecord,
  SkillSource,
} from "api-server-api";

import { externalLinkProps } from "@/lib/external-link";
import { emitToast } from "@/lib/toast";

import { useStore } from "../../../store.js";
import type { SkillsDerivations } from "./use-skills-derivations.js";
import type { SkillsSurface } from "./use-skills-surface.js";

export function useSkillsConfirms(
  surface: SkillsSurface,
  derived: SkillsDerivations,
): {
  deleteStandaloneWithConfirm: (
    skill: LocalSkill,
    pub?: SkillPublishRecord,
  ) => Promise<void>;
  trackWithConfirm: (
    skill: LocalSkill,
    pub: SkillPublishRecord,
  ) => Promise<void>;
  toggleAllWithConfirm: (
    source: SkillSource,
    on: boolean,
    scope?: Skill[],
  ) => Promise<void>;
  removeSourceWithConfirm: (source: SkillSource) => Promise<void>;
} {
  const showConfirm = useStore((s) => s.showConfirm);
  const { skillsBySource, installedRef } = surface;

  const deleteStandaloneWithConfirm = async (
    skill: LocalSkill,
    pub?: SkillPublishRecord,
  ) => {
    const ok = await showConfirm(
      <>
        This skill will be removed from the agent.
        {pub && (
          <>
            {" The "}
            <a href={pub.prUrl} {...externalLinkProps} className="underline">
              pull request
            </a>{" "}
            you published to {pub.sourceName} isn't withdrawn.
          </>
        )}
      </>,
      `Delete ${skill.name}?`,
      { kind: "destructive", confirmLabel: "Delete skill" },
    );
    if (ok) await surface.deleteStandalone(skill);
  };

  const trackWithConfirm = async (
    skill: LocalSkill,
    pub: SkillPublishRecord,
  ) => {
    const scanned = skillsBySource[pub.sourceId]?.find(
      (s) => s.name === skill.name,
    );
    if (!scanned) return;
    const diverged = skill.contentHash !== scanned.contentHash;
    const ok = await showConfirm(
      diverged ? (
        <>
          Your local copy differs from the version in {pub.sourceName}. Tracking
          replaces it with the published version and your local changes are
          lost. To contribute them instead, use <strong>Publish again</strong>.
        </>
      ) : (
        <>
          This skill will be tracked from {pub.sourceName}. Updates published
          there will keep it current.
        </>
      ),
      `Track ${skill.name} from ${pub.sourceName}?`,
      diverged
        ? { kind: "destructive", confirmLabel: "Replace and track" }
        : { confirmLabel: "Track skill" },
    );
    if (!ok) return;
    if (await surface.update(scanned)) {
      emitToast({
        kind: "success",
        message: `Tracking ${skill.name} from ${pub.sourceName}`,
      });
    }
  };

  const toggleAllWithConfirm = async (
    src: SkillSource,
    on: boolean,
    scope?: Skill[],
  ) => {
    const list = scope ?? derived.listBySource.get(src.id) ?? [];
    if (!on) {
      const removing = list.filter(
        (s) => installedRef(s.source, s.name) !== undefined,
      ).length;
      const ok = await showConfirm(
        `${removing} skill${removing === 1 ? "" : "s"} from ${src.name} will be removed from the agent. You can turn ${removing === 1 ? "it" : "them"} back on at any time.`,
        scope
          ? `Disable the ${removing} matching skill${removing === 1 ? "" : "s"} from ${src.name}?`
          : `Disable all skills from ${src.name}?`,
        {
          kind: "destructive",
          confirmLabel: scope ? "Disable matching" : "Disable all",
        },
      );
      if (!ok) return;
    }
    await surface.toggleSource(src.id, list, on);
  };

  const removeSourceWithConfirm = async (src: SkillSource) => {
    const ok = await showConfirm(
      "This skill source will be removed, you will need to add the github source url again to re-access these skills.",
      `Delete ${src.name}?`,
      { kind: "destructive", confirmLabel: "Delete connection" },
    );
    if (ok) await surface.removeSource(src.id);
  };

  return {
    deleteStandaloneWithConfirm,
    trackWithConfirm,
    toggleAllWithConfirm,
    removeSourceWithConfirm,
  };
}
