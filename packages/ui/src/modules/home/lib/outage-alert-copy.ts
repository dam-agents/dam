import type { OutageAlertAffectedBy, OutageAlertNotice } from "api-server-api";
import { match } from "ts-pattern";

import { clockLabel } from "../../../lib/format-time.js";

export interface OutageAlertCopy {
  meta: string;
  headline: string;
  detail: string;
}

export function outageAlertCopy(
  alert: OutageAlertNotice,
  provider: string,
): OutageAlertCopy {
  const since = clockLabel(alert.since);
  if (alert.recoveredAt !== null)
    return {
      meta: "Provider recovered",
      headline: `${provider} works again`,
      detail: `It had problems from ${since} to ${clockLabel(alert.recoveredAt)}. Runs that failed in that time do not run again.`,
    };
  const count = alert.agents.length;
  return {
    meta: "Provider outage",
    headline: `${provider} is not responding`,
    detail:
      count === 1
        ? `Since ${since}. Work that ran on its own failed for 1 of your agents.`
        : `Since ${since}. Work that ran on its own failed for ${count} of your agents.`,
  };
}

export function outageAlertDismissHint(provider: string): string {
  return `Hides this from Approvals. The agents can still fail until ${provider} works again.`;
}

function affectedByLabel(reason: OutageAlertAffectedBy): string {
  return match(reason)
    .with("schedule", () => "Scheduled run failed")
    .with("slack", () => "Slack channel")
    .with("telegram", () => "Telegram chat")
    .exhaustive();
}

export function affectedByLine(
  reasons: readonly OutageAlertAffectedBy[],
): string {
  return reasons.map(affectedByLabel).join(" · ");
}
