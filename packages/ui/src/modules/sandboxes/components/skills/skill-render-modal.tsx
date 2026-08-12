import { Renew } from "@carbon/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { Skill, SkillSource } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { gitBlobUrl, repoSlug } from "@/lib/git-source";

import { trpc } from "../../../../trpc.js";
import { SkillChip, SkillMarkdownModal } from "./skill-markdown-modal.js";

/**
 * Renders a source-backed skill's `SKILL.md` in-product (frontmatter + markdown
 * body) so a user can understand it without leaving for GitHub. The Local Skill
 * counterpart is {@link LocalSkillRenderModal}; both share the modal shell.
 *
 * The state control drives the same mutation as the row's toggle, so the list,
 * the source's bulk button and the counts all follow from one place.
 */
export function SkillRenderModal({
  source,
  skill,
  agentId,
  visibility,
  installed,
  hasDrift,
  disabled,
  onToggle,
  onUpdate,
  onClose,
}: {
  source: SkillSource;
  skill: Skill;
  agentId: string | null;
  /** Repo visibility, where the scan proved it — absent renders no chip. */
  visibility?: "public" | "private";
  installed: boolean;
  /** Installed content differs from the latest scan. Shares its predicate with
   *  the row, so the drawer and the list can never disagree about drift. */
  hasDrift: boolean;
  /** No pod to write through — the toggle renders but refuses. */
  disabled: boolean;
  onToggle: () => void;
  onUpdate: () => void;
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
      headerAction={
        hasDrift ? (
          <Button
            variant="outline"
            size="xs"
            disabled={disabled}
            onClick={onUpdate}
            className="shrink-0"
          >
            <Renew size={13} /> Update to latest
          </Button>
        ) : undefined
      }
      stateControl={
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            {installed ? "On" : "Off"}
          </span>
          <Switch
            checked={installed}
            onCheckedChange={onToggle}
            label={`${installed ? "Uninstall" : "Install"} ${skill.name}`}
            className={disabled ? "pointer-events-none opacity-50" : undefined}
          />
        </span>
      }
      chips={
        <>
          {visibility && (
            <SkillChip className="capitalize">{visibility}</SkillChip>
          )}
          <SkillChip>{repoSlug(source.gitUrl)}</SkillChip>
          <SkillChip className="font-mono">
            {skill.version.slice(0, 7)}
          </SkillChip>
        </>
      }
      path={`${dir}/SKILL.md`}
      linkHref={gitBlobUrl(source.gitUrl, skill.version, `${dir}/SKILL.md`)}
      isPending={isPending}
      isError={isError}
      content={data?.content}
      onClose={onClose}
    />
  );
}
