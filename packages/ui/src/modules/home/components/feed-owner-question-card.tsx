import type { OwnerQuestionNotice } from "api-server-api";

import { Button } from "@/components/ui/button";

import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { answerByLine } from "../../invocations/lib/delegation-state.js";
import { FeedNoticeCard } from "./feed-notice-card.js";

interface Props {
  notice: OwnerQuestionNotice;
  agentName: string;
  avatarName: string | undefined;
  avatar: string | null | undefined;
  onOpen: () => void;
}

// UNIT_BOUNDARY_DESCRIPTION: a sub-agent's question among the things that need the owner: it says who asks and what, and leads to the chat whose input takes the answer. It is not answered or dismissed here, and goes once the question is answered.
export function FeedOwnerQuestionCard({
  notice,
  agentName,
  avatarName,
  avatar,
  onOpen,
}: Props) {
  return (
    <FeedNoticeCard
      testId="feed-owner-question-card"
      warning
      meta={
        <>
          {avatarName !== undefined && (
            <AgentAvatar name={avatarName} avatar={avatar} size={20} />
          )}
          <span className="truncate">{agentName}</span>
        </>
      }
      headline={`${notice.title} needs your answer`}
      dismiss={null}
      footerStart={answerByLine(notice.answerBy)}
      footerEnd={
        <Button size="sm" onClick={onOpen}>
          Answer in chat
        </Button>
      }
    >
      <p className="mt-2 line-clamp-3 text-sm break-words text-muted-foreground">
        {notice.text}
      </p>
    </FeedNoticeCard>
  );
}
