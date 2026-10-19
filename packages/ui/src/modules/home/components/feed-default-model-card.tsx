import type { DefaultModelNotice } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import {
  defaultModelDetail,
  defaultModelHeadline,
} from "../lib/default-model-copy.js";

interface Props {
  notice: DefaultModelNotice;
  agentName: string;
  avatarName: string | undefined;
  avatar: string | null | undefined;
  onDismiss: () => void;
  onOpen?: () => void;
}

export function FeedDefaultModelCard({
  notice,
  agentName,
  avatarName,
  avatar,
  onDismiss,
  onOpen,
}: Props) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const changed = notice.state === "changed";
  const open = () => {
    onOpen?.();
    navigateToSandboxHome(notice.agentId, "providers");
  };

  return (
    <div
      data-testid="feed-default-model-card"
      className="group w-full rounded-lg border border-border bg-card/80 p-5 text-left"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            {!changed && (
              <span className="size-2 shrink-0 rounded-full bg-warning" />
            )}
            {avatarName !== undefined && (
              <AgentAvatar name={avatarName} avatar={avatar} size={20} />
            )}
            <span className="truncate">{agentName}</span>
          </div>
          <p className="text-md leading-snug font-semibold text-foreground">
            {defaultModelHeadline(notice)}
          </p>
        </div>
        {!changed && (
          <button
            type="button"
            onClick={onDismiss}
            title="Hides this from the bell. The agent still has no default it can run."
            className="shrink-0 text-sm text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-foreground"
          >
            Dismiss
          </button>
        )}
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {defaultModelDetail(notice)}
      </p>

      <div className="-mx-5 -mb-5 mt-3 flex items-center justify-end gap-2 border-t border-border px-5 py-2.5">
        {changed && (
          <Button size="sm" variant="outline" onClick={onDismiss}>
            OK
          </Button>
        )}
        <Button size="sm" onClick={open}>
          {changed ? "Change" : "Choose a model"}
        </Button>
      </div>
    </div>
  );
}
