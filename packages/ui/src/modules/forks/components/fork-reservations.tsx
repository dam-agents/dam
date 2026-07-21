import type { ForkView } from "api-server-api";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SectionLabel } from "@/components/ui/section-label";

import { useEndFork } from "../api/mutations.js";
import { useMyForks } from "../api/queries.js";
import { ForkRow } from "./fork-row.js";

/** Itemizes the caller's fork reservations next to the budget meter: forks
 *  acting as you reserve compute against YOUR budget while their pods run
 *  (#2843). Ending one frees the room immediately. Renders nothing when the
 *  caller has no forks. */
export function ForkReservations() {
  const { data: forks = [] } = useMyForks();
  const [endTarget, setEndTarget] = useState<ForkView | null>(null);
  const endFork = useEndFork();

  if (forks.length === 0) return null;

  return (
    <section className="mb-6">
      <SectionLabel spaced>Your forks</SectionLabel>
      <p className="mb-3 text-[13px] text-muted-foreground">
        Turns you run on other people&apos;s sandboxes execute on forks — they
        reserve your compute budget while running, and free it when they
        hibernate.
      </p>
      <Card className="overflow-hidden">
        <div className="-mt-px">
          {forks.map((fork) => (
            <ForkRow
              key={fork.forkId}
              fork={fork}
              title={fork.agentId}
              onEnd={setEndTarget}
            />
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={endTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEndTarget(null);
        }}
        kind="destructive"
        title="End this fork?"
        description="The fork is deleted immediately — any turn it is running is interrupted. Your next Slack reply on that sandbox starts a fresh one."
        confirmLabel="End fork"
        onConfirm={() => {
          if (endTarget) endFork.mutate({ forkId: endTarget.forkId });
          setEndTarget(null);
        }}
      />
    </section>
  );
}
