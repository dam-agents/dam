import type { SecurityCheckNotice } from "api-server-api";

import { Button } from "@/components/ui/button";

import { timeAgo } from "../../../lib/format-time.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { FeedNoticeCard } from "../../home/components/feed-notice-card.js";
import {
  SECURITY_CHECK_DISMISS_HINT,
  SECURITY_CHECK_OPEN_LABEL,
  securityCheckHeadline,
} from "../lib/security-check-copy.js";

interface Props {
  notice: SecurityCheckNotice;
  agentName: string;
  avatarName: string | undefined;
  avatar: string | null | undefined;
  now: Date;
  onOpen: () => void;
  onDismiss: () => void;
}

// UNIT_BOUNDARY_DESCRIPTION: what the assistant's security check found, as one card among the things that need the owner: a short title for each problem, leading to the chat where the assistant described them and offers to fix them. Nothing is fixed here; a dismissal only hides this report.
export function FeedSecurityCheckCard({
  notice,
  agentName,
  avatarName,
  avatar,
  now,
  onOpen,
  onDismiss,
}: Props) {
  return (
    <FeedNoticeCard
      testId="feed-security-check-card"
      warning
      meta={
        <>
          {avatarName !== undefined && (
            <AgentAvatar name={avatarName} avatar={avatar} size={20} />
          )}
          <span className="truncate">{agentName}</span>
        </>
      }
      headline={securityCheckHeadline(notice.problems.length)}
      dismiss={{ title: SECURITY_CHECK_DISMISS_HINT, onDismiss }}
      footerStart={`Checked ${timeAgo(notice.reportedAt, now)}`}
      footerEnd={
        <Button size="sm" onClick={onOpen}>
          {SECURITY_CHECK_OPEN_LABEL}
        </Button>
      }
    >
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
        {notice.problems.map((problem, index) => (
          <li key={`${String(index)}:${problem}`} className="break-words">
            {problem}
          </li>
        ))}
      </ul>
    </FeedNoticeCard>
  );
}
