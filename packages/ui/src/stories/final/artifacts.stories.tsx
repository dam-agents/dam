import {
  Add,
  Checkmark,
  ChevronRight,
  Document,
  Download,
  Earth,
  Folder,
  Search,
  Share,
  Upload,
} from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react";

import { SlackColorIcon } from "@/components/brand-icons";
import { ListSkeleton } from "@/components/list-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EmptyHero,
  MockAgentMessage,
  MockCard,
  MockChip,
  MockPrompt,
} from "@/components/ui/empty-hero";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import { PageShell } from "../pages/_shell";

const meta: Meta = {
  title: "Final/Artifacts Page",
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

/* ── Fixtures ─────────────────────────────────────────────────────────── */

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

const BARS = [30, 55, 45, 80, 60, 90, 70];

/* ── Helpers ──────────────────────────────────────────────────────────── */

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

/* ── Stories ───────────────────────────────────────────────────────────── */

export const Empty: Story = {
  render: () => (
    <PageShell activeNav="artifacts" maxWidth="full">
      <EmptyHero
        title="Artifacts"
        actions={
          <>
            <Button size="lg">Create agent</Button>
            <Button size="lg" variant="outline">
              Upload artifact
            </Button>
          </>
        }
        illustration={
          <div className="flex flex-col">
            <MockPrompt className="w-[68%]">
              Pull our weekly metrics and build me a dashboard every Monday
            </MockPrompt>
            <MockChip className="top-[12%] right-[18%]">
              <Share size={14} />
            </MockChip>
            <MockCard className="z-10 -mt-2 ml-[33%] flex gap-4">
              <div className="flex w-28 shrink-0 flex-col gap-1.5 rounded-md border border-border p-2">
                <div className="flex gap-1">
                  <span className="h-2.5 flex-1 rounded-sm bg-muted" />
                  <span className="h-2.5 flex-1 rounded-sm bg-muted" />
                  <span className="h-2.5 flex-1 rounded-sm bg-success-light" />
                </div>
                <div className="flex h-10 items-end gap-1 rounded-sm border border-border px-1">
                  {BARS.map((h, i) => (
                    <span
                      key={i}
                      style={{ height: `${h}%` }}
                      className={
                        i === BARS.length - 1
                          ? "flex-1 bg-accent"
                          : "flex-1 bg-accent/40"
                      }
                    />
                  ))}
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="font-semibold">Weekly metrics dashboard</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1 rounded-full bg-success-light px-2 py-0.5 text-success">
                    <Earth size={12} />
                    Public
                  </span>
                  HTML · 38 KB
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="truncate rounded-sm border border-border px-2 py-1 font-mono text-xs">
                    share.example.com/a/pw4SYBykUQQ
                  </span>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border text-success">
                    <Checkmark size={14} />
                  </span>
                </div>
              </div>
            </MockCard>
            <MockChip className="top-[44%] left-[4%]">
              <SlackColorIcon className="size-4" />
            </MockChip>
            <MockAgentMessage time="6:00 AM" className="mt-4 ml-[12%] w-[68%]">
              Weekly dashboard is ready. Signups up 12% this week.
              <div className="truncate text-accent">
                share.example.com/a/pw4SYBykUQQ…
              </div>
            </MockAgentMessage>
          </div>
        }
      >
        Pages and files your agents create land here. Preview them, share them
        with a public link, or have an agent post them to Slack when they're
        ready.
      </EmptyHero>
    </PageShell>
  ),
};

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
