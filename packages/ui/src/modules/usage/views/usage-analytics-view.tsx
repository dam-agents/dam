import { Launch } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

import { getBrand } from "../../../brand.js";
import { useOpenUsageReport } from "../api/mutations.js";

export function UsageAnalyticsView() {
  const brandShort = getBrand().short;
  const open = useOpenUsageReport();

  return (
    <div className="anim-in">
      <PageHeader
        title="Usage analytics"
        description={`How people are adopting ${brandShort}: who comes back each week, how new users get through their first three weeks, which features they pick up, and what the live agents look like.`}
      />

      <Card className="p-5">
        <p className="text-sm text-muted-foreground">
          The report is built from the activity log when you open it and shows
          in a new tab. Every count leaves out the {brandShort} team, and all
          days are UTC. The top section covers the last 7 complete days; the
          cohort and weekly sections use calendar weeks from Monday to Sunday.
        </p>
        <div className="mt-5">
          <Button
            onClick={() => open.mutate(window.open("about:blank", "_blank"))}
            disabled={open.isPending}
          >
            <Launch size={14} />
            {open.isPending ? "Building the report…" : "Open the report"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
