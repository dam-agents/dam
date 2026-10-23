import { MICROS_PER_UNIT, type SpendUnit } from "api-server-api";

function amount(micros: number, maxDecimals: number): string {
  return (micros / MICROS_PER_UNIT).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDecimals,
  });
}

const BARE_AMOUNTS: Readonly<Record<SpendUnit, (micros: number) => string>> = {
  usd: (micros) => `$${amount(micros, 2)}`,
  usd_list: (micros) => `$${amount(micros, 2)}`,
  bobcoin: (micros) => amount(micros, 6),
  free: () => "$0.00",
};

const UNIT_SUFFIXES: Readonly<Record<SpendUnit, string>> = {
  usd: "",
  usd_list: " subscription value",
  bobcoin: " Bobcoins",
  free: "",
};

const SPENT_SUFFIXES: Readonly<Record<SpendUnit, string>> = {
  ...UNIT_SUFFIXES,
  usd_list: " covered",
};

export const UNIT_NAMES: Readonly<Record<SpendUnit, string>> = {
  usd: "USD",
  usd_list: "USD value",
  bobcoin: "Bobcoins",
  free: "USD",
};

export const NO_LIMIT_REASONS: Readonly<
  Record<"free" | "not_priced" | "not_metered", string>
> = {
  free: "This provider has no billing.",
  not_priced:
    "Calls on this provider are not priced yet, so it takes no spend limit.",
  not_metered:
    "Calls on this provider are not measured, so it takes no spend limit.",
};

export function bareSpend(micros: number, unit: SpendUnit): string {
  return BARE_AMOUNTS[unit](micros);
}

export function formatSpend(micros: number, unit: SpendUnit): string {
  return `${bareSpend(micros, unit)}${UNIT_SUFFIXES[unit]}`;
}

export function formatSpent(micros: number, unit: SpendUnit): string {
  return `${bareSpend(micros, unit)}${SPENT_SUFFIXES[unit]}`;
}

export function formatSpendOf(
  spentMicros: number,
  limitMicros: number,
  unit: SpendUnit,
): string {
  return `${bareSpend(spentMicros, unit)} of ${bareSpend(limitMicros, unit)}${UNIT_SUFFIXES[unit]}`;
}

export function amountText(micros: number): string {
  return String(micros / MICROS_PER_UNIT);
}

export function microsToUsd(micros: number): number {
  return micros / MICROS_PER_UNIT;
}

export function localResetTime(resetsAt: string | Date): string {
  return new Date(resetsAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function localDayStart(utcDay: string): string {
  return localResetTime(`${utcDay}T00:00:00Z`);
}
