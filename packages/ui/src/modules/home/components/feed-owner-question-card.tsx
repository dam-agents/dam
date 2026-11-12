import type { OwnerQuestionNotice } from "api-server-api";

import { Button } from "@/components/ui/button";

import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { answerByLine } from "../../invocations/lib/delegation-state.js";
import { FeedNoticeCard } from "./feed-notice-card.js";

interface Props {
  notices: readonly OwnerQuestionNotice[];
  agentName: string;
  avatarName: string | undefined;
  avatar: string | null | undefined;
  onOpen: (notice: OwnerQuestionNotice) => void;
  onDismiss: () => void;
}

// UNIT_BOUNDARY_DESCRIPTION: the questions the sub-agents of one Agent wait on, as one card among the things that need the owner: who asks and what, each leading to the chat whose input takes its answer. Nothing is answered here; a dismissal only hides the card, and a question goes once it is answered.
export function FeedOwnerQuestionCard({
  notices,
  agentName,
  avatarName,
  avatar,
  onOpen,
  onDismiss,
}: Props) {
  const first = notices[0];
  if (!first) return null;
  const single = notices.length === 1;
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
      headline={
        single
          ? `${first.title} needs your answer`
          : `${notices.length} temporary agents need your answer`
      }
      dismiss={{
        title:
          "Hides this from Approvals. The question still waits in the chat.",
        onDismiss,
      }}
      footerStart={single ? answerByLine(first.answerBy) : undefined}
      footerEnd={
        <Button size="sm" onClick={() => onOpen(first)}>
          Answer in chat
        </Button>
      }
    >
      {single ? (
        <p className="mt-2 line-clamp-3 text-sm break-words text-muted-foreground">
          {first.text}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {notices.map((notice) => (
            <li key={`${notice.id}:${notice.askedAt}`} className="text-sm">
              <button
                type="button"
                onClick={() => onOpen(notice)}
                className="w-full rounded-md text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-hidden"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {notice.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {answerByLine(notice.answerBy)}
                  </span>
                </span>
                <span className="line-clamp-2 break-words text-muted-foreground">
                  {notice.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </FeedNoticeCard>
  );
}
