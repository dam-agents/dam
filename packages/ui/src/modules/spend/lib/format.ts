import { MICROS_PER_UNIT, type SpendUnit } from "api-server-api";

function amount(micros: number, maxDecimals: number): string {
  return (micros / MICROS_PER_UNIT).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDecimals,
  });
}

const UNIT_FORMATS: Readonly<Record<SpendUnit, (micros: number) => string>> = {
  usd: (micros) => `$${amount(micros, 2)}`,
  usd_list: (micros) => `list $${amount(micros, 2)}`,
  bobcoin: (micros) => `${amount(micros, 6)} Bobcoins`,
  free: () => "$0.00",
};

export const UNIT_NAMES: Readonly<Record<SpendUnit, string>> = {
  usd: "USD",
  usd_list: "list USD",
  bobcoin: "Bobcoins",
  free: "USD",
};

export function formatSpend(micros: number, unit: SpendUnit): string {
  return UNIT_FORMATS[unit](micros);
}

export function amountText(micros: number): string {
  return String(micros / MICROS_PER_UNIT);
}

export function microsToUsd(micros: number): number {
  return micros / MICROS_PER_UNIT;
}
