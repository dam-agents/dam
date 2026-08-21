import { useQuery } from "@tanstack/react-query";
import type { LocalSkill, SkillPublishRecord } from "api-server-api";
import type { ReactNode } from "react";

import { trpc } from "../../../../trpc.js";
import { SkillChip, SkillMarkdownModal } from "./skill-markdown-modal.js";

function stateLabel(skill: LocalSkill): string {
  return skill.origin === "system" || skill.origin === "system-modified"
    ? "Always on · ships with the image"
    : "Always on";
}

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
  publish?: SkillPublishRecord;
  onDownload: () => void;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const { data, isPending, isError } = useQuery({
    ...trpc.skills.readLocal.queryOptions({ agentId, name: skill.name }),
    retry: false,
  });
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
            {builtIn ? "sandbox image" : "created in this agent"}
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
