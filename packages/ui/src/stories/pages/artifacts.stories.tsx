import {
  Add,
  ChevronRight,
  Document,
  Download,
  Folder,
  Search,
  Upload,
} from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListSkeleton } from "@/components/list-skeleton";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import { PageShell } from "./_shell";

const meta: Meta = {
  title: "Pages/Artifacts",
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

const folders = [
  {
    name: "PR Reviews",
    artifacts: [
      { name: "PR-482-review.md", size: "12 KB", updated: "2h ago" },
      { name: "PR-479-review.md", size: "8 KB", updated: "1d ago" },
      { name: "PR-475-summary.md", size: "4 KB", updated: "3d ago" },
    ],
  },
  {
    name: "Generated Docs",
    artifacts: [
      { name: "openapi-spec.yaml", size: "48 KB", updated: "5h ago" },
      { name: "api-reference.md", size: "24 KB", updated: "1d ago" },
    ],
  },
];

const ungroupedArtifacts = [
  { name: "dependency-report.json", size: "156 KB", updated: "12h ago" },
  { name: "test-coverage.html", size: "320 KB", updated: "1d ago" },
  { name: "changelog-v2.4.md", size: "6 KB", updated: "2d ago" },
];

function ArtifactRow({
  name,
  size,
  updated,
}: {
  name: string;
  size: string;
  updated: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-4 py-3 transition-colors hover:bg-muted/40">
      <Document size={16} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
      </div>
      <span className="shrink-0 text-sm text-muted-foreground">{size}</span>
      <span className="shrink-0 text-sm text-muted-foreground">{updated}</span>
      <button
        type="button"
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        <Download size={16} />
      </button>
    </div>
  );
}

function FolderGroup({
  name,
  artifacts,
}: (typeof folders)[number]) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
        <Folder size={16} className="shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{name}</span>
        <Badge variant="muted" className="ml-1 text-xs">
          {artifacts.length}
        </Badge>
      </button>
      <div className="border-t border-border">
        {artifacts.map((a) => (
          <ArtifactRow key={a.name} {...a} />
        ))}
      </div>
    </div>
  );
}

export const Populated: Story = {
  render: () => (
    <PageShell activeNav="artifacts">
      <PageHeader
        title="Artifacts"
        description="Files and outputs produced by agent sessions."
        actions={
          <div className="flex gap-2">
            <Button variant="outline">
              <Add size={16} /> New folder
            </Button>
            <Button>
              <Upload size={16} /> Upload artifact
            </Button>
          </div>
        }
      />

      <div className="relative mt-1">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input placeholder="Search artifacts..." className="pl-9" />
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {folders.map((folder) => (
          <FolderGroup key={folder.name} {...folder} />
        ))}

        <SectionLabel spaced className="mt-2">
          Recent files
        </SectionLabel>
        <div className="rounded-lg border border-border bg-card">
          {ungroupedArtifacts.map((a) => (
            <ArtifactRow key={a.name} {...a} />
          ))}
        </div>
      </div>

      <p className="mt-4 text-[14px] text-muted-foreground">
        {folders.reduce((sum, f) => sum + f.artifacts.length, 0) +
          ungroupedArtifacts.length}{" "}
        artifacts &middot; 578 KB stored
      </p>
    </PageShell>
  ),
};

export const Empty: Story = {
  render: () => (
    <PageShell activeNav="artifacts">
      <PageHeader
        title="Artifacts"
        description="Files and outputs produced by agent sessions."
        actions={
          <div className="flex gap-2">
            <Button variant="outline">
              <Add size={16} /> New folder
            </Button>
            <Button>
              <Upload size={16} /> Upload artifact
            </Button>
          </div>
        }
      />

      <PageEmptyState
        title="No artifacts yet"
        message="When your agents produce files — reports, code, logs, or exports — they'll appear here. Start a session to generate your first artifacts."
        actionLabel="Go to agents"
        actionIcon={<Add size={16} />}
        onAction={() => {}}
      />
    </PageShell>
  ),
};

export const Loading: Story = {
  render: () => (
    <PageShell activeNav="artifacts">
      <PageHeader
        title="Artifacts"
        description="Files and outputs produced by agent sessions."
      />
      <div className="mt-4">
        <ListSkeleton rows={3} rowHeight={70} />
      </div>
    </PageShell>
  ),
};
