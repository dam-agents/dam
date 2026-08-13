import { useQuery } from "@tanstack/react-query";
import type { Skill, SkillSource } from "api-server-api";

import { gitBlobUrl } from "@/lib/git-source";

import { trpc } from "../../../../trpc.js";
import { SkillMarkdownModal } from "./skill-markdown-modal.js";

export function SkillRenderModal({
  source,
  skill,
  agentId,
  onClose,
}: {
  source: SkillSource;
  skill: Skill;
  agentId: string | null;
  onClose: () => void;
}) {
  const { data, isPending, isError } = useQuery({
    ...trpc.skills.getSkillContent.queryOptions({
      sourceId: source.id,
      name: skill.name,
      ...(agentId ? { agentId } : {}),
    }),
    retry: false,
  });
  const dir =
    skill.dir ?? data?.dir ?? `${source.path ?? "skills"}/${skill.name}`;

  return (
    <SkillMarkdownModal
      title={skill.name}
      description={skill.description}
      linkHref={gitBlobUrl(source.gitUrl, skill.version, `${dir}/SKILL.md`)}
      isPending={isPending}
      isError={isError}
      content={data?.content}
      onClose={onClose}
    />
  );
}
