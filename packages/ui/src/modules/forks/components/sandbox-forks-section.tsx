import type { ForkView } from "api-server-api";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SectionLabel } from "@/components/ui/section-label";

import { useEndFork } from "../api/mutations.js";
import { useAgentForks } from "../api/queries.js";
import { ForkRow } from "./fork-row.js";

/** The sandbox-home "Forks" section: the durable per-replier runtimes other
 *  users' Slack replies run on — who, lifecycle state, last activity — with
 *  an owner-side "End now" (#2843). */
export function SandboxForksSection({ agentId }: { agentId: string }) {
  const { data: forks = [], isLoading } = useAgentForks(agentId);
  const [endTarget, setEndTarget] = useState<ForkView | null>(null);
  const endFork = useEndFork();

  return (
    <section className="mb-8">
      <SectionLabel spaced>Forks</SectionLabel>
      <p className="mb-3 text-[14px] text-muted-foreground">
        When a teammate replies to this sandbox in Slack, their turns run on a
        fork — a separate runtime using their credentials over the shared
        workspace. Forks hibernate after a few idle minutes and expire after a
        couple of idle days.
      </p>

      {isLoading ? (
        <p className="text-[13px] text-muted-foreground">Loading…</p>
      ) : forks.length === 0 ? (
        <Card className="px-5 py-8 text-center">
          <p className="text-[14px] text-muted-foreground">
            No forks — nobody else has driven this sandbox from Slack recently.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* first-row border-t is hidden by the card edge */}
          <div className="-mt-px">
            {forks.map((fork) => (
              <ForkRow
                key={fork.forkId}
                fork={fork}
                title={fork.replierSub}
                onEnd={setEndTarget}
              />
            ))}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={endTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEndTarget(null);
        }}
        kind="destructive"
        title="End this fork?"
        description={`The fork for ${endTarget?.replierSub ?? ""} is deleted immediately — any turn it is running is interrupted. Their next Slack reply starts a fresh one.`}
        confirmLabel="End fork"
        onConfirm={() => {
          if (endTarget) endFork.mutate({ forkId: endTarget.forkId });
          setEndTarget(null);
        }}
      />
    </section>
  );
}
