import { Chemistry } from "@carbon/icons-react";
import type {
  ArtifactFolder,
  Experiment,
  LibraryArtifact,
} from "api-server-api";
import { EXPERIMENT_FOLDER_PREFIX } from "api-server-api";
import { useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import { DisclosureChevron } from "@/components/ui/disclosure";

import { useExperimentsAmbient } from "../../experiments/api/queries.js";
import type { ArtifactRowActions } from "./artifact-row.js";
import {
  FolderGroup,
  type FolderGroupActions,
  type FolderSection,
} from "./folder-group.js";

interface Props extends ArtifactRowActions, FolderGroupActions {
  /** Only the platform-managed experiment lineage folders. */
  folders: ArtifactFolder[];
  byFolder: Map<string | null, LibraryArtifact[]>;
  /** A live search: open everything so matches inside are reachable. */
  searching: boolean;
}

/** Artifact rows don't know their run — the experiment rows point at their
 *  artifacts (script clone, results). Invert that into artifactId → cluster
 *  so a lineage folder can render grouped by run. Run numbers count runs
 *  oldest-first within a lineage, matching the server's title numbering. */
interface Cluster {
  label: string;
  /** Draft sorts first, then runs newest-first, unmatched files last. */
  sortKey: number;
}

function useArtifactClusters(): Map<string, Cluster> {
  const { data: experiments } = useExperimentsAmbient();
  return useMemo(() => {
    const map = new Map<string, Cluster>();
    const all: Experiment[] = experiments ?? [];
    // Drafts claim first: a live run's dashboardArtifactId still points at
    // the draft's renderer, and the draft is the right home for it.
    for (const draft of all.filter((e) => e.status === "draft")) {
      map.set(draft.scriptArtifactId, { label: "Draft", sortKey: -1 });
      if (draft.dashboardArtifactId)
        map.set(draft.dashboardArtifactId, { label: "Draft", sortKey: -1 });
    }
    const runsByLineage = new Map<string, Experiment[]>();
    for (const e of all) {
      if (e.status === "draft") continue;
      const key = `${e.driverAgentId}\n${e.name}`;
      runsByLineage.set(key, [...(runsByLineage.get(key) ?? []), e]);
    }
    for (const runs of runsByLineage.values()) {
      runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      runs.forEach((run, i) => {
        const cluster: Cluster = {
          label: `Run ${i + 1} · ${run.status}`,
          sortKey: runs.length - i,
        };
        map.set(run.scriptArtifactId, cluster);
        if (run.dashboardArtifactId && !map.has(run.dashboardArtifactId))
          map.set(run.dashboardArtifactId, cluster);
      });
    }
    return map;
  }, [experiments]);
}

function partition(
  artifacts: LibraryArtifact[],
  clusters: Map<string, Cluster>,
): FolderSection[] | undefined {
  const sections = new Map<
    string,
    { sortKey: number; section: FolderSection }
  >();
  for (const artifact of artifacts) {
    const cluster = clusters.get(artifact.id) ?? {
      label: "Other files",
      sortKey: Number.MAX_SAFE_INTEGER,
    };
    const entry = sections.get(cluster.label) ?? {
      sortKey: cluster.sortKey,
      section: { label: cluster.label, artifacts: [] },
    };
    entry.section.artifacts.push(artifact);
    sections.set(cluster.label, entry);
  }
  if (sections.size <= 1) return undefined;
  return [...sections.values()]
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((e) => e.section);
}

/** Platform-managed experiment artifacts (scripts, dashboards, run results)
 *  are working files, not things the user curated — they live in one muted
 *  section at the bottom of the library, collapsed until asked for, with a
 *  nested folder per lineage grouped by run. */
export function ExperimentsSection({
  folders,
  byFolder,
  searching,
  ...actions
}: Props) {
  const [open, setOpen] = useState(false);
  const expanded = open || searching;
  const clusters = useArtifactClusters();

  const visible = searching
    ? folders.filter((f) => (byFolder.get(f.id) ?? []).length > 0)
    : folders;
  const total = folders.reduce(
    (sum, f) => sum + (byFolder.get(f.id) ?? []).length,
    0,
  );
  if (searching && visible.length === 0) return null;

  return (
    <Card className="mt-2 overflow-hidden border-dashed bg-muted/30 anim-in">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter") setOpen((o) => !o);
        }}
        className="flex cursor-pointer select-none items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-muted/60"
      >
        <DisclosureChevron open={expanded} className="text-muted-foreground" />
        <Chemistry size={16} className="shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold text-muted-foreground">
          Experiments
        </span>
        <span className="text-xs text-muted-foreground">
          {folders.length} experiment{folders.length === 1 ? "" : "s"} · {total}{" "}
          artifact{total === 1 ? "" : "s"}
        </span>
        <span className="ml-auto hidden text-xs text-muted-foreground/70 sm:block">
          scripts, dashboards and run results published by your agents
        </span>
      </div>
      {expanded &&
        visible.map((folder) => {
          const artifacts = byFolder.get(folder.id) ?? [];
          return (
            <FolderGroup
              // Remount when a search starts/ends so the folders open to show
              // matches and fold back after.
              key={`${folder.id}:${searching}`}
              nested
              defaultCollapsed={!searching}
              folder={folder}
              displayName={folder.name.slice(EXPERIMENT_FOLDER_PREFIX.length)}
              artifacts={artifacts}
              sections={partition(artifacts, clusters)}
              {...actions}
            />
          );
        })}
    </Card>
  );
}
