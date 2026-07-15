import type { SkillRef } from "api-server-api";

import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import type { AgentState } from "../../../../types.js";
import { useSkillsSurface } from "../../hooks/use-skills-surface.js";
import { SkillSourceCard } from "./skill-source-card.js";
import { SkillSourcesSkeleton } from "./skills-skeleton.js";
import { StandaloneSkillsGroup } from "./standalone-skills-group.js";

/**
 * The redesigned skills surface: skills grouped by location — Standalone Local
 * Skills ("Created in this sandbox") and Skill Sources ("Sourced from GitHub") —
 * instead of the old provenance badges. Toggles install/uninstall immediately.
 * Read-only while the agent is stopped; the container renders the wake
 * affordance.
 */
export function SkillsSurface({
  agentId,
  agentState,
  readOnly,
  onInstalledChange,
}: {
  agentId: string | null;
  agentState: AgentState | undefined;
  readOnly: boolean;
  onInstalledChange?: (installed: SkillRef[]) => void;
}) {
  const isError = agentState === "error";
  const {
    sources,
    sourcesLoaded,
    skillsBySource,
    loadingBySource,
    errorBySource,
    standalone,
    busyKey,
    installedRef,
    toggle,
  } = useSkillsSurface(agentId, { readOnly, isError, onInstalledChange });

  return (
    // Read-only (agent stopped / starting): dim and disable the whole surface
    // as one treatment, per the design — not just the toggles. The wake
    // affordance lives in the container header, outside this dimmed region.
    <div
      className={cn(
        "flex flex-col gap-8",
        readOnly && "pointer-events-none opacity-50",
      )}
    >
      {standalone.length > 0 && <StandaloneSkillsGroup skills={standalone} />}

      <section>
        <SectionLabel spaced>Sourced from GitHub</SectionLabel>
        {!sourcesLoaded ? (
          <SkillSourcesSkeleton />
        ) : sources.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No skill sources connected.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {sources.map((src) => (
              <SkillSourceCard
                key={src.id}
                source={src}
                skills={skillsBySource[src.id]}
                loading={!!loadingBySource[src.id]}
                error={errorBySource[src.id] ?? null}
                installedRef={installedRef}
                busyKey={busyKey}
                disabled={!agentId || isError}
                onToggle={toggle}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
