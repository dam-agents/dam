import { PageHeader } from "@/components/ui/page-header";

import { useStore } from "../../../store.js";
import { MeasuredUsage } from "../../spend/components/measured-usage.js";
import { OwnSpendLimitCard } from "../../spend/components/own-spend-limit-card.js";
import {
  DEFAULT_PERIOD,
  formatPeriod,
  parsePeriod,
  type SpendPeriod,
} from "../../spend/lib/spend-period.js";
import { EarlierEstimatesAccess } from "../components/earlier-estimates-access.js";

const PAGE_DESCRIPTION = (
  <span className="block max-w-[460px]">
    Spend limits, and what your agents spend on models.
  </span>
);

export function UsageView() {
  const usagePeriod = useStore((s) => s.usagePeriod);
  const setUsagePeriod = useStore((s) => s.setUsagePeriod);
  const period = parsePeriod(usagePeriod) ?? DEFAULT_PERIOD;

  function handlePeriodChange(next: SpendPeriod) {
    setUsagePeriod(formatPeriod(next));
  }

  return (
    <div>
      <PageHeader title="Usage" description={PAGE_DESCRIPTION} />
      <EarlierEstimatesAccess />
      <div className="mb-10">
        <MeasuredUsage period={period} onPeriodChange={handlePeriodChange} />
      </div>
      <OwnSpendLimitCard />
    </div>
  );
}
