import type { SpendMetering } from "api-server-api";

import { useSpendMetering } from "../api/queries.js";
import { useMeteringNoticeDismissed } from "./use-spend-preferences.js";

function isOpen(until: string | null): until is string {
  return until !== null && Date.now() < Date.parse(until);
}

export function useMeteringNotice(): SpendMetering | null {
  const { data: metering } = useSpendMetering();
  const dismissed = useMeteringNoticeDismissed();
  if (!metering || dismissed || !isOpen(metering.noticeUntil)) return null;
  return metering;
}

export function useEarlierEstimatesUntil(): string | null {
  const { data: metering } = useSpendMetering();
  const until = metering?.earlierEstimatesUntil ?? null;
  return isOpen(until) ? until : null;
}
