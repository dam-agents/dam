import type { TokenSpendByModel } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  formatDurationMs,
  formatTokens,
  formatUsd,
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
