import { type SpendUnit, spendUnitOfProvider } from "api-server-api";

const OWN_LIMIT_PROVIDERS: Partial<Record<SpendUnit, string>> = {
  usd_list: "the Claude subscription",
  bobcoin: "Bob",
};

export interface AgentLimitCoverage {
  paid: boolean;
  uncounted: string[];
  uncountedUnits: SpendUnit[];
}

export function agentLimitCoverage(
  templateIds: readonly (string | undefined)[],
): AgentLimitCoverage {
  const units = templateIds.flatMap((id) => {
    const unit = id ? spendUnitOfProvider(id) : null;
    return unit ? [unit] : [];
  });
  const uncountedUnits = [
    ...new Set(units.filter((unit) => OWN_LIMIT_PROVIDERS[unit] !== undefined)),
  ];
  return {
    paid: units.includes("usd"),
    uncounted: uncountedUnits.flatMap(
      (unit) => OWN_LIMIT_PROVIDERS[unit] ?? [],
    ),
    uncountedUnits,
  };
}

export function joinNames(names: readonly string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
