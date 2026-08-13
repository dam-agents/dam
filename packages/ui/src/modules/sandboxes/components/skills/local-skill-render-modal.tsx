import { useQuery } from "@tanstack/react-query";
import type { LocalSkill } from "api-server-api";

import { trpc } from "../../../../trpc.js";
import { SkillMarkdownModal } from "./skill-markdown-modal.js";

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
    retry: false,
  });
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
