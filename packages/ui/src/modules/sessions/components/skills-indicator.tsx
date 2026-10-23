import { Close } from "@carbon/icons-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  useSkillSourceCount,
  useSkillsState,
} from "../../agents/api/skills.js";

interface Props {
  agentId: string | null;
  onManage: () => void;
}

export function SkillsIndicator({ agentId, onManage }: Props) {
  const titleId = useId();
  const sourceCount = useSkillSourceCount(agentId);
  const { data: skillsState } = useSkillsState(agentId);

  const installedCount = skillsState?.installed?.length ?? 0;
  const standaloneCount = skillsState?.standalone?.length ?? 0;
  const totalActive = installedCount + standaloneCount;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {totalActive === 0
            ? "No skills"
            : `${totalActive} skill${totalActive === 1 ? "" : "s"}`}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        aria-labelledby={titleId}
        className="flex w-[320px] flex-col gap-0 p-0 text-sm"
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <h2
            id={titleId}
            className="text-[15px] font-semibold text-foreground"
          >
            Skills
          </h2>
          <PopoverClose asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Close"
              className="-mr-1 -mt-1 shrink-0 text-muted-foreground"
            >
              <Close size={16} />
            </Button>
          </PopoverClose>
        </div>

        <div className="px-4 pb-3">
          {totalActive === 0 ? (
            <p className="text-sm text-muted-foreground">
              No skills active. Add skill sources to extend this agent.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {installedCount > 0 && (
                <p className="text-sm text-muted-foreground">
                  {installedCount} installed skill
                  {installedCount === 1 ? "" : "s"}
                  {sourceCount !== null && sourceCount > 0
                    ? ` from ${sourceCount} source${sourceCount === 1 ? "" : "s"}`
                    : ""}
                </p>
              )}
              {standaloneCount > 0 && (
                <p className="text-sm text-muted-foreground">
                  {standaloneCount} standalone skill
                  {standaloneCount === 1 ? "" : "s"}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border px-4 py-3">
          <PopoverClose asChild>
            <Button variant="outline" size="sm" onClick={onManage}>
              Manage
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}
