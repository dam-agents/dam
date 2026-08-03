import { Launch } from "@carbon/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { Skill, SkillSource } from "api-server-api";

import { Markdown } from "@/components/markdown";
import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Tooltip } from "@/components/ui/tooltip";
import { externalLinkProps } from "@/lib/external-link";
import { gitBlobUrl } from "@/lib/git-source";

import { trpc } from "../../../../trpc.js";

/**
 * Renders a skill's `SKILL.md` in-product (frontmatter + markdown body) so a
 * user can understand it without leaving for GitHub. Content is read from the
 * source (slice 05, public sources only — private falls back to the GitHub
 * link). The <Markdown> component handles the frontmatter block, GFM, and code
 * highlighting.
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
  const { data, isPending, isError } = useQuery(
    trpc.skills.getSkillContent.queryOptions({
      sourceId: source.id,
      name: skill.name,
      ...(agentId ? { agentId } : {}),
    }),
  );
  // Prefer the exact directory the content read resolved; before it loads (or
  // for a private source that can't be read) fall back to guessing the dir
  // from the source path + skill name — best-effort, may 404 if they diverge.
  const dir = data?.dir ?? `${source.path ?? "skills"}/${skill.name}`;
  const link = gitBlobUrl(source.gitUrl, skill.version, `${dir}/SKILL.md`);

  return (
    <Modal widthClass="w-[720px]">
      <DialogHeader
        className="border-b border-border"
        title={skill.name}
        truncateTitle
        titleAccessory={
          link && (
            <Tooltip content="View SKILL.md on GitHub">
              <a
                href={link}
                {...externalLinkProps}
                aria-label="View SKILL.md on GitHub"
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Launch size={15} />
              </a>
            </Tooltip>
          )
        }
        subtitle={
          skill.description && (
            <span className="block truncate">{skill.description}</span>
          )
        }
        onClose={onClose}
      />

      <DialogBody>
        {isPending ? (
          <div className="flex flex-col gap-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted/60" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-muted/60" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted/60" />
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">
            An in-product preview isn&rsquo;t available for this skill yet.
            {link ? " Open it on GitHub from the link above." : ""}
          </p>
        ) : (
          <Markdown>{data.content}</Markdown>
        )}
      </DialogBody>
    </Modal>
  );
}
