import { CheckmarkFilled, Information } from "@carbon/icons-react";
import type { AvatarCharacter } from "api-server-api/avatar/svg";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { AvatarEgg } from "./avatar-egg.js";

interface Props {
  title: string;
  hint: string;
  reward: AvatarCharacter | null;
  onStart: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One checklist task: what to do, one line on why,
 * and the character it unlocks, an egg while it is locked. The row opens the
 * place where the task is done; the info mark beside the title is its own
 * button, so a keyboard user reads the line without leaving the checklist.
 */
export function ChecklistTaskRow({ title, hint, reward, onStart }: Props) {
  const done = reward !== null;
  return (
    <li className="list-none">
      <div className="flex items-center gap-1 pr-3 transition-colors hover:bg-muted/40">
        <button
          type="button"
          onClick={onStart}
          className="flex min-w-0 flex-1 items-center gap-3 py-1.5 pl-4 text-left"
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            {done ? (
              <CheckmarkFilled size={16} className="text-success" />
            ) : (
              <span className="size-4 rounded-full border-2 border-border" />
            )}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              done ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {title}
          </span>
        </button>
        <Tooltip content={hint} side="right">
          <button
            type="button"
            aria-label={`About ${title}`}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Information size={14} />
          </button>
        </Tooltip>
        <span className="flex size-6 shrink-0 items-center justify-center">
          {reward ? (
            <AgentAvatar name="" avatar={reward} size={24} />
          ) : (
            <AvatarEgg className="size-5" />
          )}
        </span>
      </div>
    </li>
  );
}
