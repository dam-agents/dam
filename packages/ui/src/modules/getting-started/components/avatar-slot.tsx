import type { AvatarCharacter } from "api-server-api/avatar/svg";

import { cn } from "@/lib/utils";

import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { AvatarEgg } from "./avatar-egg.js";

interface Props {
  character: AvatarCharacter | null;
  justUnlocked: boolean;
}

export function AvatarSlot({ character, justUnlocked }: Props) {
  return (
    <div
      className={cn(
        "flex size-8 items-center justify-center rounded-md border",
        character
          ? "border-border bg-card"
          : "border-dashed border-border bg-muted/30",
      )}
    >
      {character ? (
        <div
          className={cn(
            "flex",
            justUnlocked &&
              "animate-[unlock-pop_0.5s_cubic-bezier(0.34,1.56,0.64,1)]",
          )}
        >
          <AgentAvatar name="" avatar={character} size={24} />
        </div>
      ) : (
        <AvatarEgg className="size-5" />
      )}
    </div>
  );
}
