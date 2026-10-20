import { match } from "ts-pattern";

import { getBrand } from "../../../brand.js";
import { clockLabel } from "../../../lib/format-time.js";
import type { ProviderCondition } from "../api/queries.js";

export interface ProviderErrorCopy {
  title: string;
  message: string;
  hint: string;
}

export function providerErrorCopy({
  condition,
  providerName,
  interrupted,
  recovered,
}: {
  condition: ProviderCondition;
  providerName: string | null;
  interrupted: boolean;
  recovered: boolean;
}): ProviderErrorCopy {
  const brand = getBrand().name;
  const provider = providerName ?? "The model provider";
  const title = interrupted ? "Response interrupted:" : "Send failed:";
  return match(condition)
    .with({ kind: "dam-side" }, () => ({
      title,
      message: `${brand} cannot reach model providers.`,
      hint: `The problem is on ${brand}'s side, not with ${providerName ?? "the model provider"} or your setup. Your message was saved.`,
    }))
    .with({ kind: "degraded" }, ({ outage }) => ({
      title,
      message: `${provider} has had problems since ${clockLabel(outage.since)}.`,
      hint: "Your setup is not the cause. Your message was saved. Retry when it works again, or switch this agent to a different provider.",
    }))
    .with({ kind: "no-outage" }, () => ({
      title,
      message: `${provider} didn't respond.`,
      hint: recovered
        ? `${provider} works again. Retry now.`
        : "Your message was saved. Retry in a few minutes. If it keeps failing, switch this agent to a different provider.",
    }))
    .exhaustive();
}
