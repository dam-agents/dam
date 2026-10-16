import type { SpendUnit } from "./types.js";

const PROVIDER_UNITS: Readonly<Record<string, SpendUnit>> = {
  anthropic: "usd",
  "ibm-litellm": "usd",
  openai: "usd",
  bedrock: "usd",
  "anthropic-oauth": "usd_list",
  bob: "bobcoin",
  "curve-bender": "free",
  "platform-llm": "free",
};

const UNPRICED_PROVIDERS: ReadonlySet<string> = new Set(["openai", "bedrock"]);

export function spendUnitOfProvider(templateId: string): SpendUnit | null {
  return PROVIDER_UNITS[templateId] ?? null;
}

type NoConnectionLimit = {
  readonly limitable: false;
  readonly reason: "free" | "not_priced" | "not_metered";
};

export type ConnectionLimitRule =
  { readonly limitable: true; readonly unit: SpendUnit } | NoConnectionLimit;

const CONNECTION_LIMIT_REFUSALS: Readonly<
  Record<NoConnectionLimit["reason"], string>
> = {
  free: "Calls on this Connection are free, so it takes no spend limit.",
  not_priced:
    "Calls on this Connection are not priced yet, so it takes no spend limit.",
  not_metered:
    "Calls on this Connection are not metered, so it takes no spend limit.",
};

export function connectionLimitRule(templateId: string): ConnectionLimitRule {
  const unit = spendUnitOfProvider(templateId);
  if (unit === null) return { limitable: false, reason: "not_metered" };
  if (unit === "free") return { limitable: false, reason: "free" };
  if (UNPRICED_PROVIDERS.has(templateId)) {
    return { limitable: false, reason: "not_priced" };
  }
  return { limitable: true, unit };
}

export function connectionLimitRefusal(rule: NoConnectionLimit): string {
  return CONNECTION_LIMIT_REFUSALS[rule.reason];
}
