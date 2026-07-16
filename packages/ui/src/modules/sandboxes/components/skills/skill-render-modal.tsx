import { useQuery } from "@tanstack/react-query";
import type { Skill, SkillSource } from "api-server-api";
import { ExternalLink, X } from "lucide-react";

import { Markdown } from "@/components/markdown";
import { DialogBody, DialogHeader, Modal } from "@/components/modal";

import { trpc } from "../../../../trpc.js";

/** Best-effort GitHub link to the skill's SKILL.md at its pinned commit. */
function githubUrl(source: SkillSource, skill: Skill): string | null {
  const base = source.gitUrl.replace(/\.git$/, "").replace(/\/$/, "");
  const isGitLike =
    /^(?:https?:\/\/)?(?:[\w.-]+@)?(?:github|gitlab|bitbucket)/i.test(base) ||
    /github/i.test(base);
  if (!isGitLike) return null;
  const dir = source.path ?? "skills";
  return `${base}/blob/${skill.version}/${dir}/${skill.name}/SKILL.md`;
}

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
  const link = githubUrl(source, skill);
  const { data, isPending, isError } = useQuery(
    trpc.skills.getSkillContent.queryOptions({
      sourceId: source.id,
      name: skill.name,
      ...(agentId ? { agentId } : {}),
    }),
  );

  return (
    <Modal widthClass="w-[720px]">
      <DialogHeader className="flex items-start justify-between gap-3 border-b border-border">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[17px] font-semibold text-foreground">
              {skill.name}
            </h2>
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                title="View SKILL.md on GitHub"
              >
                <ExternalLink size={15} />
              </a>
            )}
          </div>
          {skill.description && (
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {skill.description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </DialogHeader>

      <DialogBody>
        {isPending ? (
          <div className="flex flex-col gap-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted/60" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-muted/60" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted/60" />
          </div>
        ) : isError || !data ? (
          <p className="text-[13px] text-muted-foreground">
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
