import { useQuery } from "@tanstack/react-query";
import type { LocalSkill, SkillPublishRecord } from "api-server-api";
import type { ReactNode } from "react";

import { trpc } from "../../../../trpc.js";
import { SkillChip, SkillMarkdownModal } from "./skill-markdown-modal.js";

/** What a Local Skill's state control says. Neither kind can be turned off —
 *  a standalone skill is simply present on disk, and an image-shipped one is
 *  baked in — so the control states the fact instead of offering a dead
 *  switch. */
function stateLabel(skill: LocalSkill): string {
  return skill.origin === "system" || skill.origin === "system-modified"
    ? "Always on · ships with the image"
    : "Always on";
}

/**
 * Renders a Local Skill's `SKILL.md` — standalone or image-baked — read off the
 * pod's PVC. No GitHub link accessory: a Local Skill has no source, and a
 * published one's pull request is a different thing than this file (the chip
 * links it).
 *
 * `agentId` is non-optional: without a pod there is nothing to read.
 */
export function LocalSkillRenderModal({
  skill,
  agentId,
  publish,
  onDownload,
  footer,
  onClose,
}: {
  skill: LocalSkill;
  agentId: string;
  /** Latest publish record, when this skill has ever been published — shown as
   *  a chip that links its pull request. */
  publish?: SkillPublishRecord;
  onDownload: () => void;
  /** Publish and delete, for a created-here skill. */
  footer?: ReactNode;
  onClose: () => void;
}) {
  const { data, isPending, isError } = useQuery({
    ...trpc.skills.readLocal.queryOptions({ agentId, name: skill.name }),
    // Same reasoning as the source-backed modal: the pod's NOT_FOUND /
    // PAYLOAD_TOO_LARGE are verdicts, and retrying them strands the skeleton.
    retry: false,
  });
  // Every Local Skill has a SKILL.md by definition, so a missing (or binary)
  // one means something is wrong — the shell's error state, not a blank body.
  const manifest = data?.files.find((f) => f.relPath === "SKILL.md");
  const builtIn =
    skill.origin === "system" || skill.origin === "system-modified";

  return (
    <SkillMarkdownModal
      title={skill.name}
      stateControl={
        <span className="text-sm text-muted-foreground">
          {stateLabel(skill)}
        </span>
      }
      chips={
        <>
          <SkillChip>{builtIn ? "Built-in" : "Standalone"}</SkillChip>
          <SkillChip>
            {builtIn ? "sandbox image" : "created in this sandbox"}
          </SkillChip>
          <SkillChip className="font-mono">
            {builtIn ? "image" : "local"}
          </SkillChip>
          {publish && (
            <SkillChip>
              <a
                href={publish.prUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:underline"
              >
                {publish.sourceName}
              </a>
            </SkillChip>
          )}
        </>
      }
      path={data ? `${data.dir}/SKILL.md` : `${skill.name}/SKILL.md`}
      onDownload={onDownload}
      isPending={isPending}
      isError={isError}
      content={manifest?.base64 ? undefined : manifest?.content}
      footer={footer}
      onClose={onClose}
    />
  );
}
