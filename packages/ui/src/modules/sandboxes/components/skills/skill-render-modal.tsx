import { useQuery } from "@tanstack/react-query";
import type { Skill, SkillSource } from "api-server-api";

import { gitBlobUrl } from "@/lib/git-source";

import { trpc } from "../../../../trpc.js";
import { SkillMarkdownModal } from "./skill-markdown-modal.js";

/**
 * Renders a source-backed skill's `SKILL.md` in-product (frontmatter + markdown
 * body) so a user can understand it without leaving for GitHub. The Local Skill
 * counterpart is {@link LocalSkillRenderModal}; both share the modal shell.
 */
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
    // A refusal here is a verdict (unsupported host, skill gone, no GitHub
    // grant), not a transient fault. The global `retry: 3` would also strand
    // the modal on its skeleton: with networkMode "online" the retryer pauses
    // instead of failing, leaving the query `pending` and the message unseen.
    retry: false,
  });
  // Both scans report each skill's real directory, so the link is right before
  // the content query resolves. The guess covers only a sandbox whose runtime
  // predates reporting `dir`.
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
