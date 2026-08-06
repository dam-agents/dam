import { useQuery } from "@tanstack/react-query";
import type { LocalSkill } from "api-server-api";

import { trpc } from "../../../../trpc.js";
import { SkillMarkdownModal } from "./skill-markdown-modal.js";

/**
 * Renders a Local Skill's `SKILL.md` — standalone or image-baked — read off the
 * pod's PVC. No GitHub link accessory: a Local Skill has no source, and a
 * published one's pull request is a different thing than this file (the row
 * already links it).
 *
 * `agentId` is non-optional: without a pod there is nothing to read.
 */
export function LocalSkillRenderModal({
  skill,
  agentId,
  onClose,
}: {
  skill: LocalSkill;
  agentId: string;
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

  return (
    <SkillMarkdownModal
      title={skill.name}
      description={skill.description}
      isPending={isPending}
      isError={isError}
      content={manifest?.base64 ? undefined : manifest?.content}
      onClose={onClose}
    />
  );
}
