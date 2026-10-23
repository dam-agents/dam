import { WarningAlt } from "@carbon/icons-react";
import type { SlackLoopGuardDrops } from "api-server-api";

import { Notice } from "@/components/ui/notice";
import { externalLinkProps } from "@/lib/external-link";

import { LOOP_GUARD_DOCS_URL } from "../../../../constants.js";
import { loopGuardNoticeCopy } from "../../lib/slack-loop-guard.js";

export function SlackLoopGuardNotice({
  drops,
}: {
  drops: SlackLoopGuardDrops;
}) {
  const copy = loopGuardNoticeCopy(drops);
  return (
    <Notice
      icon={WarningAlt}
      tone="warning"
      className="mx-4 mb-3"
      title={copy.title}
    >
      {copy.rule}{" "}
      <a
        href={LOOP_GUARD_DOCS_URL}
        {...externalLinkProps}
        className="font-medium text-foreground underline underline-offset-2"
      >
        How the loop guard works
      </a>
      {copy.latest && (
        <span className="mt-1 block" data-testid="slack-loop-guard-recent">
          Latest: {copy.latest}
        </span>
      )}
    </Notice>
  );
}
