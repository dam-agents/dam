import { MICROS_PER_UNIT } from "./schemas.js";
import type { SpendUnit } from "./types.js";

function decimal(micros: number): string {
  const exact = (micros / MICROS_PER_UNIT).toFixed(6).replace(/0+$/, "");
  const [whole = "0", fraction = ""] = exact.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

const UNIT_FORMATS: Readonly<Record<SpendUnit, (amount: string) => string>> = {
  usd: (amount) => `$${amount}`,
  usd_list: (amount) => `list $${amount}`,
  bobcoin: (amount) => `${amount} Bobcoins`,
  free: () => "$0.00",
};

export function formatSpendAmount(micros: number, unit: SpendUnit): string {
  return UNIT_FORMATS[unit](decimal(micros));
}
