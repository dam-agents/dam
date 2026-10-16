import { Close, Information } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

import { useSpendMetering } from "../api/queries.js";
import {
  useDismissMeteringNotice,
  useMeteringNoticeDismissed,
} from "../hooks/use-spend-preferences.js";
import {
  DISMISS_NOTICE,
  METERING_NOTICE_DETAIL,
  meteringNoticeTitle,
} from "../lib/copy.js";

interface Props {
  className?: string;
  children?: ReactNode;
}

export function MeteringNotice({ className, children }: Props) {
  const { data: metering } = useSpendMetering();
  const dismissed = useMeteringNoticeDismissed();
  const dismiss = useDismissMeteringNotice();
  const until = metering?.noticeUntil;
  if (!metering || !until || dismissed || Date.now() >= Date.parse(until)) {
    return null;
  }
  return (
    <Callout
      tone="info"
      size="sm"
      role="note"
      className={cn("flex items-start gap-2.5 text-sm", className)}
    >
      <Information size={16} className="mt-0.5 shrink-0 text-accent" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <strong className="font-semibold text-foreground">
          {meteringNoticeTitle(metering.startDay)}
        </strong>
        <span className="text-muted-foreground">{METERING_NOTICE_DETAIL}</span>
        {children}
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={DISMISS_NOTICE}
        onClick={dismiss}
        className="shrink-0 text-muted-foreground"
      >
        <Close size={16} />
      </Button>
    </Callout>
  );
}
