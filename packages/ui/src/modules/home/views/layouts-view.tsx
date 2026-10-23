import { useMemo } from "react";

import { usePendingApprovals } from "../../approvals/api/queries.js";
import {
  ApprovalCardPreview,
  ArtifactCard,
  ComputePreview,
  ExperimentCard,
  ScheduleCard,
  SessionFinishedCard,
  SessionRunningCard,
  SpendPreview,
} from "./comparison-view.js";

export function LayoutsView() {
  const { data: pendingApprovals } = usePendingApprovals();
  const approvals = useMemo(() => pendingApprovals ?? [], [pendingApprovals]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[22px] font-bold text-foreground">Home</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          What your agents have been up to, and what needs your attention.
        </p>
      </div>

      {/* Blocked — real approval cards from compare page */}
      {approvals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold text-foreground">
            Needs your decision
          </h2>
          {approvals.map((row) => (
            <ApprovalCardPreview key={row.id} row={row} />
          ))}
        </section>
      )}

      {/* Running now — same cards as compare page cards 3-5 */}
      <section className="space-y-3">
        <h2 className="text-[18px] font-semibold text-foreground">
          Running now
        </h2>
        <SessionRunningCard
          title="Implement dark mode toggle"
          agentName="frontend-agent"
          updatedAt="12m ago"
        />
        <ExperimentCard
          agentName="color-palette-testing"
          experimentName="Spring palette — warm vs cool tones"
          status="running"
          runningInvocations={3}
        />
        <ScheduleCard
          name="Daily brand audit"
          cadence="Every weekday at 9:00 AM"
          nextRun="in 3h"
          lastResult="success"
          enabled={true}
        />
      </section>

      {/* Resource widgets — compare page cards 12-13 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SpendPreview />
        <ComputePreview />
      </div>

      {/* Ready for you — same cards as compare page cards 6-11 */}
      <section className="space-y-3">
        <h2 className="text-[18px] font-semibold text-foreground">
          Ready for you
        </h2>
        <SessionFinishedCard
          title="Refactor auth middleware"
          agentName="backend-refactor"
          updatedAt="45m ago"
          scheduled={false}
        />
        <ArtifactCard
          title="Spring campaign hero images"
          agentName="brand-asset-generator"
          updatedAt="2h ago"
        />
        <SessionFinishedCard
          title="Daily brand audit"
          agentName="brand-asset-generator"
          updatedAt="6h ago"
          scheduled={true}
        />
        <ArtifactCard
          title="Nightly performance report"
          agentName="reporting-agent"
          updatedAt="8h ago"
        />
        <ExperimentCard
          agentName="color-palette-testing"
          experimentName="Spring palette — warm vs cool tones"
          status="completed"
          runningInvocations={0}
          completedRuns={5}
        />
        <ScheduleCard
          name="Nightly test suite"
          cadence="Every day at 2:00 AM"
          nextRun="in 14h"
          lastResult="failed: agent exceeded timeout after 45m"
          enabled={true}
        />
      </section>
    </div>
  );
}
