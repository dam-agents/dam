import type { TokenSpendByModel } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  formatCreditsExact,
  formatDurationMs,
  formatSpend,
  formatTokens,
  formatUsd,
  spendBarPct,
  topPerUnit,
} from "../../modules/metrics/lib/format.js";
import { totalCostUsd } from "../../modules/metrics/lib/totals.js";

describe("formatTokens", () => {
  test("compacts large counts", () => {
    expect(formatTokens(1_234_567)).toBe("1.2M");
    expect(formatTokens(950)).toBe("950");
  });
});

describe("formatUsd", () => {
  test("keeps sub-cent precision, rounds larger sums", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.00342)).toBe("$0.0034");
    expect(formatUsd(1.239)).toBe("$1.24");
  });
});

describe("formatDurationMs", () => {
  test("scales units", () => {
    expect(formatDurationMs(420)).toBe("420ms");
    expect(formatDurationMs(4200)).toBe("4.2s");
    expect(formatDurationMs(90_000)).toBe("1m 30s");
  });
});

describe("totalCostUsd", () => {
  test("sums per-model cost, zero for no rows", () => {
    expect(totalCostUsd([])).toBe(0);
    expect(
      totalCostUsd([
        { costUsd: 1.5 } as TokenSpendByModel,
        { costUsd: 0.25 } as TokenSpendByModel,
      ]),
    ).toBe(1.75);
  });
});

describe("credit-billed spend", () => {
  test("shows a credit total instead of reading as $0", () => {
    expect(formatSpend(0, [{ unit: "bobcoin", amount: 1234 }])).toBe(
      "1.2K Bobcoins",
    );
    expect(formatSpend(2.5, [{ unit: "bobcoin", amount: 40 }])).toBe(
      "$2.50 + 40 Bobcoins",
    );
    expect(formatSpend(2.5, [])).toBe("$2.50");
  });

  test("scales each bar against the largest row sharing its unit", () => {
    expect(
      spendBarPct([
        { costUsd: 10, credits: [] },
        { costUsd: 5, credits: [] },
        { costUsd: 0, credits: [{ unit: "bobcoin", amount: 200 }] },
        { costUsd: 0, credits: [{ unit: "bobcoin", amount: 50 }] },
      ]),
    ).toEqual([100, 50, 100, 25]);
  });
});

describe("mixed-unit ranking and precision", () => {
  test("keeps a credit-billed agent reachable in a dollar-dominated top-N", () => {
    const rows = [
      { costUsd: 10, credits: [] },
      { costUsd: 5, credits: [] },
      { costUsd: 1, credits: [] },
      { costUsd: 0, credits: [{ unit: "bobcoin", amount: 900 }] },
    ];
    expect(topPerUnit(rows, 3)).toEqual([rows[0], rows[3], rows[1]]);
  });

  test("scales a multi-unit row on its largest credit, not on position zero", () => {
    expect(
      spendBarPct([
        { costUsd: 0, credits: [{ unit: "a", amount: 1 }] },
        {
          costUsd: 0,
          credits: [
            { unit: "a", amount: 2 },
            { unit: "b", amount: 400 },
          ],
        },
        { costUsd: 0, credits: [{ unit: "b", amount: 800 }] },
      ]),
    ).toEqual([100, 50, 100]);
  });

  test("gives a reconcilable total rather than a compacted one", () => {
    expect(formatCreditsExact([{ unit: "bobcoin", amount: 1234.5 }])).toBe(
      "1,234.5 Bobcoins",
    );
  });
});
