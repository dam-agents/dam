import { Launch } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

import { getBrand } from "../../../brand.js";
import { routeToPath } from "../../platform/lib/routes.js";

const REPORT_PATH = routeToPath({ view: "analytics" });

export function UsageAnalyticsView() {
  const brandShort = getBrand().short;
  const address = `${window.location.origin}${REPORT_PATH}`;

  return (
    <div>
      <PageHeader
        title="Usage analytics"
        description={`How people are adopting ${brandShort}: who comes back each week, how new users get through their first three weeks, which features they pick up, and what the live agents look like.`}
      />

      <Card className="p-5">
        <p className="text-sm text-muted-foreground">
          The report is built from the activity log every time it is opened.
          Every count leaves out the {brandShort} team, and all days are UTC.
          The top section covers the last 7 complete days; the cohort and weekly
          sections use calendar weeks from Monday to Sunday.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Its address,{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
            {address}
          </code>
          , can be shared with other inspectors. Anyone else who opens it sees a
          no-access page.
        </p>
        <div className="mt-5">
          <Button asChild>
            <a href={REPORT_PATH} target="_blank" rel="noopener">
              <Launch size={14} />
              Open the report
            </a>
          </Button>
        </div>
      </Card>
    </div>
  );
}
