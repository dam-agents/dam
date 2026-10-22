import { spendUnitOfProvider, type SpendUnit } from "api-server-api";

export type { SpendUnit };

export const UNIT_RANK: readonly SpendUnit[] = [
  "usd",
  "usd_list",
  "bobcoin",
  "free",
];

export function unitOf(provider: string): SpendUnit {
  return spendUnitOfProvider(provider) ?? "usd";
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
