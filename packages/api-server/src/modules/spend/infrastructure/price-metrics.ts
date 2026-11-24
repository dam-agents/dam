import type { Meter } from "@opentelemetry/api";

export interface PricedModelLabels {
  readonly provider: string;
  readonly model: string;
}

export type PriceReadOutcome = "ok" | "refused" | "error";

export interface PriceMetrics {
  proxyCostCompared(labels: PricedModelLabels): void;
  proxyCostDiffers(labels: PricedModelLabels): void;
  priceRead(labels: {
    readonly provider: string;
    readonly outcome: PriceReadOutcome;
  }): void;
  operatorPriceDiffers(labels: PricedModelLabels): void;
  awaitingPrice(labels: PricedModelLabels): void;
  repriced(
    labels: { readonly provider: string; readonly kind: string },
    calls: number,
  ): void;
}

export function createOtelPriceMetrics(meter: Meter): PriceMetrics {
  const compared = meter.createCounter("platform.spend.proxy_cost.compared", {
    description:
      "Completed dollar calls whose reply carried the proxy's own cost, compared with DAM's cost",
  });
  const differs = meter.createCounter("platform.spend.proxy_cost.differs", {
    description:
      "Compared calls whose DAM cost differs from the proxy's own cost by more than 5%",
  });
  const reads = meter.createCounter("platform.spend.price_reads", {
    description:
      "Reads of a provider's own price list with one Connection's key, by outcome",
  });
  const operatorDiffers = meter.createCounter(
    "platform.spend.operator_price_differs",
    {
      description:
        "Operator prices from the chart that differ from the provider's own price list",
    },
  );
  const awaiting = meter.createCounter("platform.spend.awaiting_price", {
    description:
      "Calls that no price source could price, counted at no cost until their price arrives",
  });
  const repriced = meter.createCounter("platform.spend.repriced", {
    description:
      "Call rows priced again once their model's price arrived, by kind",
  });
  const modelAttributes = ({ provider, model }: PricedModelLabels) => ({
    provider,
    model,
  });
  return {
    proxyCostCompared: (labels) => compared.add(1, modelAttributes(labels)),
    proxyCostDiffers: (labels) => differs.add(1, modelAttributes(labels)),
    priceRead: ({ provider, outcome }) => reads.add(1, { provider, outcome }),
    operatorPriceDiffers: (labels) =>
      operatorDiffers.add(1, modelAttributes(labels)),
    awaitingPrice: (labels) => awaiting.add(1, modelAttributes(labels)),
    repriced: ({ provider, kind }, calls) =>
      repriced.add(calls, { provider, kind }),
  };
}
