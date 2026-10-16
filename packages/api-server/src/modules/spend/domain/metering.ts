import type { SpendMetering } from "api-server-api";
import { utcDay } from "./ledger.js";

const METERING_NOTICE_MS = 30 * 24 * 60 * 60 * 1000;

export function meteringNoticeEnd(startedAt: Date): Date {
  return new Date(startedAt.getTime() + METERING_NOTICE_MS);
}

export function meteringView(input: {
  startedAt: Date;
  now: Date;
  ownsAgentFromBeforeStart: boolean;
  telemetryStoreOn: boolean;
}): SpendMetering {
  const end = meteringNoticeEnd(input.startedAt);
  const open = input.now < end ? end.toISOString() : null;
  return {
    startedAt: input.startedAt.toISOString(),
    startDay: utcDay(input.startedAt),
    noticeUntil: input.ownsAgentFromBeforeStart ? open : null,
    earlierEstimatesUntil: input.telemetryStoreOn ? open : null,
  };
}
