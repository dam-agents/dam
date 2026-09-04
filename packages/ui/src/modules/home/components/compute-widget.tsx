import type { AgentView } from "../../../types.js";
import { ComputeUsage } from "../../budgets/components/compute-usage.js";

export function ComputeWidget({ agents }: { agents: readonly AgentView[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <ComputeUsage agents={agents} />
    </div>
  );
}
