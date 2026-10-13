export type SpendUnit = "usd" | "usd_list" | "bobcoin" | "free";

const PROVIDER_UNITS: Readonly<Record<string, SpendUnit>> = {
  anthropic: "usd",
  "ibm-litellm": "usd",
  openai: "usd",
  bedrock: "usd",
  "anthropic-oauth": "usd_list",
  bob: "bobcoin",
  "curve-bender": "free",
};

const UNIT_RANK: readonly SpendUnit[] = ["usd", "usd_list", "bobcoin", "free"];

export function unitOf(provider: string): SpendUnit {
  return PROVIDER_UNITS[provider] ?? "usd";
}

export function payingProvider(providers: readonly string[]): {
  provider: string;
  ambiguous: boolean;
} {
  const ranked = [...new Set(providers)].sort(
    (a, b) =>
      UNIT_RANK.indexOf(unitOf(a)) - UNIT_RANK.indexOf(unitOf(b)) ||
      a.localeCompare(b),
  );
  return { provider: ranked[0] ?? "", ambiguous: ranked.length > 1 };
}
