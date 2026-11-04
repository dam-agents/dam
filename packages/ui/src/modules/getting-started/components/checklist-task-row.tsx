import { CheckmarkFilled, Information } from "@carbon/icons-react";
import type { AvatarCharacter } from "api-server-api/avatar/svg";
import { useId } from "react";

import { ExplainerPopover } from "@/components/explainer-popover";
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
 * place where the task is done. The info mark beside the title is its own
 * button, not a hover-only tooltip: a tap, a click or Enter opens the line, so
 * a touch user reads it too, and its always-present description carries it to
 * a screen reader on focus.
 */
export function ChecklistTaskRow({ title, hint, reward, onStart }: Props) {
  const done = reward !== null;
  const hintId = useId();
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
        <span id={hintId} className="sr-only">
          {hint}
        </span>
        <ExplainerPopover
          label={`About ${title}`}
          describedBy={hintId}
          icon={Information}
          side="right"
          align="start"
          className="size-6 rounded-md hover:bg-muted"
        >
          {hint}
        </ExplainerPopover>
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
