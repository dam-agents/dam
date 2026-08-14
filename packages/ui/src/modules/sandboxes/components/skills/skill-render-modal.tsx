import { Renew } from "@carbon/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { Skill, SkillSource } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { gitBlobUrl, repoSlug } from "@/lib/git-source";

import { trpc } from "../../../../trpc.js";
import { SkillChip, SkillMarkdownModal } from "./skill-markdown-modal.js";

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
  visibility?: "public" | "private";
  installed: boolean;
  hasDrift: boolean;
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
    retry: false,
  });
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
            disabled={disabled}
            label={`${installed ? "Uninstall" : "Install"} ${skill.name}`}
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
