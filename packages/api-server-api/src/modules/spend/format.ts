import { MICROS_PER_UNIT } from "./schemas.js";
import type { SpendUnit } from "./types.js";

function decimal(micros: number): string {
  const exact = (micros / MICROS_PER_UNIT).toFixed(6).replace(/0+$/, "");
  const [whole = "0", fraction = ""] = exact.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

const UNIT_FORMATS: Readonly<Record<SpendUnit, (amount: string) => string>> = {
  usd: (amount) => `$${amount}`,
  usd_list: (amount) => `$${amount} subscription value`,
  bobcoin: (amount) => `${amount} Bobcoins`,
  free: () => "$0.00",
};

export function formatSpendAmount(micros: number, unit: SpendUnit): string {
  return UNIT_FORMATS[unit](decimal(micros));
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function nextUtcMidnight(now: Date = new Date()): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS + DAY_MS);
}

export function formatLocalResetTime(at: Date | string): string {
  const local = new Date(at).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${local} your time (00:00 UTC)`;
}
