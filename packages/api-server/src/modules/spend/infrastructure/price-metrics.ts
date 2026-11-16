import type { Meter } from "@opentelemetry/api";

export interface PricedModelLabels {
  readonly provider: string;
  readonly model: string;
}

export interface PriceMetrics {
  proxyCostCompared(labels: PricedModelLabels): void;
  proxyCostDiffers(labels: PricedModelLabels): void;
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
  const attributes = ({ provider, model }: PricedModelLabels) => ({
    provider,
    model,
  });
  return {
    proxyCostCompared: (labels) => compared.add(1, attributes(labels)),
    proxyCostDiffers: (labels) => differs.add(1, attributes(labels)),
  };
}
