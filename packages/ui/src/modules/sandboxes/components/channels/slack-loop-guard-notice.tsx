import { WarningAlt } from "@carbon/icons-react";
import type { SlackLoopGuardDrops } from "api-server-api";

import { Notice } from "@/components/ui/notice";
import { externalLinkProps } from "@/lib/external-link";
import { clockLabel, formatDate, sameLocalDay } from "@/lib/format-time";

import { LOOP_GUARD_DOCS_URL } from "../../../../constants.js";

function dropTime(at: string): string {
  return sameLocalDay(new Date(at), new Date())
    ? clockLabel(at)
    : `${formatDate(at, { month: "short", day: "numeric" })}, ${clockLabel(at)}`;
}

export function SlackLoopGuardNotice({
  drops,
}: {
  drops: SlackLoopGuardDrops;
}) {
  const posts = drops.dropped === 1 ? "post" : "posts";
  return (
    <Notice
      icon={WarningAlt}
      tone="warning"
      className="mx-4 mb-3"
      title={`${drops.dropped} bot or app ${posts} dropped by the loop guard, last ${dropTime(drops.lastDroppedAt)}.`}
    >
      Once three bot or app posts in a row reach one conversation, later ones
      start no turn until a person posts there, a day passes without one being
      let through, or the platform restarts.{" "}
      <a
        href={LOOP_GUARD_DOCS_URL}
        {...externalLinkProps}
        className="font-medium text-foreground underline underline-offset-2"
      >
        How the loop guard works
      </a>
      {drops.recent.length > 0 && (
        <span className="mt-1 block" data-testid="slack-loop-guard-recent">
          Latest:{" "}
          {drops.recent
            .map(
              (drop) =>
                `${drop.name} (${drop.sender === "agent" ? "agent" : "app"}, ${drop.thread ? "in a thread" : "top level"}, ${dropTime(drop.at)})`,
            )
            .join("; ")}
        </span>
      )}
    </Notice>
  );
}
