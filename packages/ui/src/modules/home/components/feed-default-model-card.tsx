import type { DefaultModelNotice } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import {
  defaultModelAction,
  defaultModelDetail,
  defaultModelHeadline,
} from "../lib/default-model-copy.js";
import { FeedNoticeCard } from "./feed-notice-card.js";

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
    navigateToSandboxHome(notice.agentId, "models");
  };

  return (
    <FeedNoticeCard
      testId="feed-default-model-card"
      warning={!changed}
      meta={
        <>
          {avatarName !== undefined && (
            <AgentAvatar name={avatarName} avatar={avatar} size={20} />
          )}
          <span className="truncate">{agentName}</span>
        </>
      }
      headline={defaultModelHeadline(notice)}
      dismiss={
        changed
          ? null
          : {
              title:
                "Hides this from Approvals. The agent's schedules and channel turns still won't run.",
              onDismiss,
            }
      }
      footerEnd={
        <>
          {changed && (
            <Button size="sm" variant="outline" onClick={onDismiss}>
              OK
            </Button>
          )}
          <Button size="sm" onClick={open}>
            {defaultModelAction(notice)}
          </Button>
        </>
      }
    >
      <p className="mt-2 text-sm text-muted-foreground">
        {defaultModelDetail(notice)}
      </p>
    </FeedNoticeCard>
  );
}
