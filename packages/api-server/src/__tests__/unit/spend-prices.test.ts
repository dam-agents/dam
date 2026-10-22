// TEST_OVERVIEW: the spend meter prices a finished provider by its template. The deployment's CurveBender is the same free proxy as the user-keyed one, so it costs nothing either, and an operator price the deployment's provider names still overrides that.
import { describe, expect, it } from "vitest";

import {
  type PriceBook,
  type PriceQuery,
  lookupPrice,
} from "../../modules/spend/domain/prices.js";

const book = (operatorPrices: PriceBook["operatorPrices"] = []): PriceBook => ({
  operatorPrices,
  anthropicTable: [],
});

const query: PriceQuery = {
  provider: "curve-bender-deployment",
  pathModel: "rits/zai-org/glm-5-3",
  replyModel: null,
};

describe("deployment CurveBender pricing", () => {
  // TEST_SCENARIO: a call on the deployment's CurveBender is priced as free by the provider rule, as the user-keyed proxy is, rather than unpriced.
  it("prices the deployment provider as the free proxy", () => {
    expect(lookupPrice(book(), query)).toEqual({
      kind: "zero",
      source: "provider-rule",
    });
  });

  // TEST_SCENARIO: an operator price override naming the deployment's CurveBender wins over that rule, as it does for the user-keyed proxy.
  it("applies an operator override for the deployment provider", () => {
    const override = {
      provider: "curve-bender-deployment",
      model: "rits/zai-org/glm-5-3",
      row: { prices: { input: 5, output: 6 } },
    };
    expect(lookupPrice(book([override]), query)).toMatchObject({
      kind: "row",
      source: "override",
      row: override.row,
    });
  });
});
