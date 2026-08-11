import type {
  LocalSkill,
  SkillPublishRecord,
  SkillSource,
} from "api-server-api";

import { externalLinkProps } from "@/lib/external-link";
import { emitToast } from "@/lib/toast";

import { useStore } from "../../../store.js";
import type { SkillsDerivations } from "./use-skills-derivations.js";
import type { SkillsSurface } from "./use-skills-surface.js";

/**
 * The skills surface's destructive and governance actions, each behind the
 * confirm that states what it will do. Grouped here because they share one
 * shape — a dialog, then one call on the surface — and because the wording is
 * the substance: what each sentence promises is the reviewable part.
 */
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
  toggleAllWithConfirm: (source: SkillSource, on: boolean) => Promise<void>;
  removeSourceWithConfirm: (source: SkillSource) => Promise<void>;
} {
  const showConfirm = useStore((s) => s.showConfirm);
  const { skillsBySource, installedRef } = surface;

  const deleteStandaloneWithConfirm = async (
    skill: LocalSkill,
    pub?: SkillPublishRecord,
  ) => {
    // Nothing here knows the PR's state, so the wording stays state-neutral —
    // "isn't withdrawn", not "is still open" (#3019).
    const ok = await showConfirm(
      <>
        This skill will be removed from the sandbox.
        {pub && (
          // Leading space joins this onto the sentence above: JSX drops the
          // newline whitespace that would otherwise separate them.
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

  /**
   * Hand a merged skill over to its source. This is a governance change, not
   * housekeeping — once tracked, a future install overwrites the local copy —
   * so it is an explicit action with a confirm that states what will happen,
   * rather than something that fires on a schedule.
   */
  const trackWithConfirm = async (
    skill: LocalSkill,
    pub: SkillPublishRecord,
  ) => {
    const scanned = skillsBySource[pub.sourceId]?.find(
      (s) => s.name === skill.name,
    );
    // The kebab item is disabled in this case; guard anyway rather than guess.
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
    // The existing install path is the migration: it fetches the skill at a
    // version, writes it into every Skill Path, and upserts the agent_skills
    // row — so no second writer of that row is introduced.
    await surface.update(scanned);
    emitToast({
      kind: "success",
      message: `Tracking ${skill.name} from ${pub.sourceName}`,
    });
  };

  /** Enabling adds; disabling removes many skills at once, so only that
   *  direction asks. Mirrors how a standalone delete and a source removal are
   *  already gated. */
  const toggleAllWithConfirm = async (src: SkillSource, on: boolean) => {
    const list = derived.listBySource.get(src.id) ?? [];
    if (!on) {
      const removing = list.filter(
        (s) => installedRef(s.source, s.name) !== undefined,
      ).length;
      const ok = await showConfirm(
        `${removing} skill${removing === 1 ? "" : "s"} from ${src.name} will be removed from the sandbox. You can turn them back on at any time.`,
        `Disable all skills from ${src.name}?`,
        { kind: "destructive", confirmLabel: "Disable all" },
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
