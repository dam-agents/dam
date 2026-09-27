import { cn } from "@/lib/utils";

import { timeAgo } from "../lib/format-time.js";
import { useStore } from "../store.js";

interface SidebarSessionItemProps {
  agentId: string;
  sessionId: string;
  title: string | null | undefined;
  running: boolean;
  updatedAt: string | null | undefined;
}

export function SidebarSessionItem({
  agentId,
  sessionId,
  title,
  running,
  updatedAt,
}: SidebarSessionItemProps) {
  const openAgentSession = useStore((s) => s.openAgentSession);
  const currentSessionId = useStore((s) => s.sessionId);
  const active = currentSessionId === sessionId;

  return (
    <button
      type="button"
      onClick={() => openAgentSession(agentId, sessionId)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {running && (
        <span className="size-1.5 shrink-0 rounded-full bg-green-500" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">
        {title || sessionId.slice(0, 12)}
      </span>
      {updatedAt && (
        <span className="shrink-0 text-xs text-muted-foreground/70">
          {timeAgo(updatedAt)}
        </span>
      )}
    </button>
  );
}
