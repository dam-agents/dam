import { Information, Play } from "@carbon/icons-react";
import type { SkillSource } from "api-server-api";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";
import { Spinner } from "@/components/ui/spinner";

import { SkillSourceList } from "./skills-source-list.js";

export function SkillsNeverRunPanel({
  sources,
  visibilityBySource,
  scannedAtBySource,
  addSourceButton,
  comingUp,
  onStart,
  onRescan,
  onRemove,
}: {
  sources: SkillSource[];
  visibilityBySource: Record<string, "public" | "private">;
  scannedAtBySource: Record<string, string>;
  addSourceButton: ReactNode;
  comingUp: boolean;
  onStart: () => void;
  onRescan: (source: SkillSource) => void;
  onRemove: (source: SkillSource) => void;
}) {
  const startButton = (
    <Button size="sm" disabled={comingUp} onClick={onStart}>
      {comingUp ? <Spinner size={13} /> : <Play size={14} />}
      {comingUp ? "Starting…" : "Start sandbox"}
    </Button>
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted px-4 py-3 text-sm">
        <Information
          size={16}
          className="mt-px shrink-0 text-muted-foreground"
        />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">
            This sandbox hasn&rsquo;t run yet
          </span>{" "}
          <span className="text-muted-foreground">
            — its skills are resolved inside the sandbox, so there&rsquo;s
            nothing recorded to show. Start it once and this page fills in.
          </span>
        </p>
        <span className="shrink-0">{startButton}</span>
      </div>

      <section>
        <SectionLabel spaced>Skills</SectionLabel>
        <Callout variant="dashed">
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Not known yet — start the sandbox to see and configure its skills.
            </p>
            <div className="flex items-center gap-2">
              {startButton}
              {addSourceButton}
            </div>
          </div>
        </Callout>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionLabel>Connected sources</SectionLabel>
          {addSourceButton}
        </div>
        <SkillSourceList
          sources={sources}
          visibilityBySource={visibilityBySource}
          scannedAtBySource={scannedAtBySource}
          onRescan={onRescan}
          onRemove={onRemove}
        />
        <p className="mt-2.5 text-sm text-muted-foreground">
          The source list is known before first boot; which of its skills are
          installed isn&rsquo;t.
        </p>
      </section>
    </div>
  );
}
