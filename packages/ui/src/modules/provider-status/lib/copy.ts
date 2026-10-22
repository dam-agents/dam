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

export interface StatusLineCopy {
  lead: string;
  rest: string;
}

export function statusLineCopy({
  condition,
  providerName,
  busy,
}: {
  condition: ProviderCondition;
  providerName: string | null;
  busy: boolean;
}): StatusLineCopy | null {
  const provider = providerName ?? "The model provider";
  return match(condition)
    .with({ kind: "no-outage" }, () => null)
    .with({ kind: "dam-side" }, ({ since }) => ({
      lead: `${getBrand().name} cannot reach model providers`,
      rest: `since ${clockLabel(since)}.`,
    }))
    .with({ kind: "degraded" }, ({ outage }) =>
      busy
        ? {
            lead: `${provider} is not responding`,
            rest: "— the agent keeps trying.",
          }
        : {
            lead: `${provider} has had problems since ${clockLabel(outage.since)}`,
            rest: "— messages may fail.",
          },
    )
    .exhaustive();
}

export interface BannerCopy {
  tone: "warning" | "danger";
  lead: string;
  body: string;
}

export function bannerCopy({
  damSide,
  names,
  since,
}: {
  damSide: boolean;
  names: readonly string[];
  since: string;
}): BannerCopy {
  const brand = getBrand().name;
  const time = clockLabel(since);
  if (damSide)
    return {
      tone: "danger",
      lead: `${brand} cannot reach model providers.`,
      body: `Since ${time}, calls to every provider fail. The problem is on ${brand}'s side, not with your providers or your setup.`,
    };
  if (names.length === 1)
    return {
      tone: "warning",
      lead: `${names[0]} is not responding.`,
      body: `Since ${time}, most calls to it fail. Agents that use it can fail until it recovers. Your setup is not the cause.`,
    };
  return {
    tone: "warning",
    lead: `${names.length} of your providers have problems: ${names.join(", ")}.`,
    body: `Since ${time}. Agents that use them can fail. Your setup is not the cause.`,
  };
}
