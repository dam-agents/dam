import { Launch } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { useStore } from "../../../store.js";
import { armColor } from "../lib/arm-color.js";
import { formatScore } from "../lib/score.js";
import type { ExperimentArmDetail } from "../types.js";
import { ArmStatusBadge } from "./arm-status-badge.js";
import { CandidateDownloadButton } from "./candidate-download-button.js";

interface Props {
  experimentId: string;
  arm: ExperimentArmDetail;
  agentName: string | null;
  templateName: string | null;
}

export function ArmLedger({
  experimentId,
  arm,
  agentName,
  templateName,
}: Props) {
  const openAgentSession = useStore((s) => s.openAgentSession);
  const trialSessionId = arm.runs[arm.runs.length - 1]?.sessionId ?? null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border p-4">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: armColor(arm.agentId) }}
        />
        <span className="font-medium text-foreground">
          {agentName ?? arm.agentId}
        </span>
        <ArmStatusBadge status={arm.status} />
        {templateName && (
          <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {templateName}
          </span>
        )}
        {trialSessionId && (
          <Button
            variant="link"
            size="xs"
            onClick={() => openAgentSession(arm.agentId, trialSessionId)}
          >
            <Launch size={14} />
            Open trial
          </Button>
        )}
        {arm.armVariation.trim() && (
          <span className="ml-auto truncate font-mono text-[12px] text-muted-foreground">
            {arm.armVariation.replace(/\s+/g, " ").trim()}
          </span>
        )}
      </div>

      {arm.runs.length === 0 ? (
        <p className="p-4 text-[13px] text-muted-foreground">No runs yet.</p>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">Run</th>
              <th className="px-4 py-2 text-right font-medium">Score</th>
              <th className="px-4 py-2 text-right font-medium">Candidate</th>
            </tr>
          </thead>
          <tbody>
            {arm.runs.map((run) => (
              <tr key={run.id} className="border-t border-border">
                <td className="px-4 py-2 font-mono text-muted-foreground">
                  #{run.runNumber}
                </td>
                <td className="px-4 py-2 text-right font-mono font-medium tabular-nums">
                  {formatScore(run.score)}
                </td>
                <td className="px-4 py-2 text-right">
                  {run.candidateRef ? (
                    <CandidateDownloadButton
                      experimentId={experimentId}
                      runId={run.id}
                      candidateRef={run.candidateRef}
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
