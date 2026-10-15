import { CheckmarkFilled } from "@carbon/icons-react";
import type { AvatarCharacter } from "api-server-api/avatar/svg";

import { cn } from "@/lib/utils";

import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { AvatarEgg } from "./avatar-egg.js";

interface Props {
  title: string;
  reward: AvatarCharacter | null;
  showReward: boolean;
  onStart: () => void;
}

export function ChecklistTaskRow({
  title,
  reward,
  showReward,
  onStart,
}: Props) {
  const done = reward !== null;
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={onStart}
        className="flex w-full items-center gap-3 px-4 py-1.5 text-left transition-colors hover:bg-muted/40"
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
        {showReward && (
          <span className="flex size-6 shrink-0 items-center justify-center">
            {reward ? (
              <AgentAvatar name="" avatar={reward} size={24} />
            ) : (
              <AvatarEgg className="size-5" />
            )}
          </span>
        )}
      </button>
    </li>
  );
}
