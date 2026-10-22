import { Locked, Sigma, UserMultiple } from "@carbon/icons-react";
import { providerTypeForTemplateId } from "api-server-api";

import { cn } from "@/lib/utils";

import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { CardIcon } from "../../providers/components/card-icon.js";
import type { Level } from "../lib/limit-levels.js";

export interface LevelAgent {
  name: string;
  avatar: string | null;
}

const TILE = "flex size-5 shrink-0 items-center justify-center rounded-[5px]";

export function LevelIcon({
  level,
  agent,
  small = false,
}: {
  level: Level;
  agent: LevelAgent | null;
  small?: boolean;
}) {
  const size = small ? "size-3.5" : "size-5";
  if (level.kind === "total") {
    return (
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center text-muted-foreground",
          size,
        )}
      >
        <Sigma size={small ? 12 : 16} />
      </span>
    );
  }
  if (level.kind === "ceiling") {
    return (
      <span
        aria-hidden
        className={cn(
          TILE,
          size,
          "border border-border bg-muted text-foreground",
        )}
      >
        <Locked size={small ? 10 : 12} />
      </span>
    );
  }
  if (level.kind === "agent") {
    return agent ? (
      <span aria-hidden className={cn("shrink-0", size)}>
        <AgentAvatar
          name={agent.name}
          avatar={agent.avatar}
          size={small ? 14 : 20}
        />
      </span>
    ) : (
      <span aria-hidden className={cn(TILE, size, "rounded-full bg-muted")} />
    );
  }
  const type = level.connection
    ? providerTypeForTemplateId(level.connection.templateId)
    : null;
  return (
    <span aria-hidden className={cn("relative flex shrink-0", size)}>
      {type ? (
        <CardIcon
          provider={type}
          templateId={level.connection?.templateId}
          size={small ? "tile-xs" : "tile-sm"}
        />
      ) : (
        <span className={cn(TILE, size, "bg-muted")} />
      )}
      {level.kind === "all-connection" && !small && (
        <span className="absolute -right-1 -bottom-1 flex size-3 items-center justify-center rounded-full border border-border bg-background text-foreground">
          <UserMultiple size={8} />
        </span>
      )}
    </span>
  );
}
