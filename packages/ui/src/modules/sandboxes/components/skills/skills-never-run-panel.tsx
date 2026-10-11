import { Information, Play } from "@carbon/icons-react";
import type { ScanFailure, SkillSource } from "api-server-api";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionHeader } from "@/components/ui/list-section";
import { Notice } from "@/components/ui/notice";
import { SectionLabel } from "@/components/ui/section-label";
import { Spinner } from "@/components/ui/spinner";

import { SkillSourceList } from "./skills-source-list.js";

export function SkillsNeverRunPanel({
  sources,
  sourcesLoaded,
  visibilityBySource,
  scannedAtBySource,
  loadingBySource,
  revalidatingBySource,
  errorBySource,
  addSourceButton,
  comingUp,
  onStart,
  onRescan,
  onRemove,
  onManageConnections,
}: {
  sources: SkillSource[];
  sourcesLoaded: boolean;
  visibilityBySource: Record<string, "public" | "private">;
  scannedAtBySource: Record<string, string>;
  loadingBySource: Record<string, boolean>;
  revalidatingBySource: Record<string, boolean>;
  errorBySource: Record<string, ScanFailure | null>;
  addSourceButton: ReactNode;
  comingUp: boolean;
  onStart: () => void;
  onRescan: (source: SkillSource) => void;
  onRemove: (source: SkillSource) => void;
  onManageConnections?: () => void;
}) {
  const startButton = (
    <Button size="sm" disabled={comingUp} onClick={onStart}>
      {comingUp ? <Spinner size={14} /> : <Play size={14} />}
      {comingUp ? "Starting…" : "Start agent"}
    </Button>
  );

  return (
    <div className="flex flex-col gap-8">
      <Notice
        icon={Information}
        title="This agent hasn’t run yet"
        action={startButton}
      >
        — its skills are resolved when it starts, so there&rsquo;s nothing
        recorded to show. Start it once and this page fills in.
      </Notice>

      <section>
        <SectionLabel spaced>Skills</SectionLabel>
        <Callout variant="dashed">
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Not known yet — start the agent to see and configure its skills.
            </p>
            <div className="flex items-center gap-2">
              {startButton}
              {addSourceButton}
            </div>
          </div>
        </Callout>
      </section>

      <section>
        <SectionHeader label="Connected sources">
          {addSourceButton}
        </SectionHeader>
        <SkillSourceList
          sources={sources}
          loaded={sourcesLoaded}
          visibilityBySource={visibilityBySource}
          scannedAtBySource={scannedAtBySource}
          loadingBySource={loadingBySource}
          revalidatingBySource={revalidatingBySource}
          errorBySource={errorBySource}
          onRescan={onRescan}
          onRemove={onRemove}
          onManageConnections={onManageConnections}
        />
        <p className="mt-2.5 text-sm text-muted-foreground">
          The source list is known before first boot; which of its skills are
          installed isn&rsquo;t.
        </p>
      </section>
    </div>
  );
}
