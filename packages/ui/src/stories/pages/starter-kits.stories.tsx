import { Add, ArrowRight, Search } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";

import { PageShell } from "./_shell";

const meta: Meta = {
  title: "Pages/Starter Kits",
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

const categories = [
  { value: "all", label: "All" },
  { value: "development", label: "Development" },
  { value: "security", label: "Security" },
  { value: "documentation", label: "Documentation" },
  { value: "quality", label: "Quality" },
] as const;

const packs = [
  {
    name: "Code Review Agent",
    tagline: "Automated PR review with style enforcement",
    category: "Development",
    tag: "Popular" as const,
    ingredients: ["Claude Code", "GitHub", "ESLint config"],
  },
  {
    name: "Dependency Auditor",
    tagline: "Continuous security scanning for npm/pip/go",
    category: "Security",
    tag: undefined,
    ingredients: ["Claude Code", "Snyk", "Slack alerts"],
  },
  {
    name: "API Doc Generator",
    tagline: "Auto-generate OpenAPI specs from source code",
    category: "Documentation",
    tag: undefined,
    ingredients: ["Claude Code", "GitHub"],
  },
  {
    name: "Bug Triage Bot",
    tagline: "Classify and prioritize incoming issues",
    category: "Development",
    tag: "New" as const,
    ingredients: ["Claude Code", "Linear", "Slack"],
  },
  {
    name: "Release Notes Writer",
    tagline: "Generate changelogs from merged PRs",
    category: "Documentation",
    tag: undefined,
    ingredients: ["Claude Code", "GitHub"],
  },
  {
    name: "Test Coverage Agent",
    tagline: "Find and fill gaps in your test suite",
    category: "Quality",
    tag: undefined,
    ingredients: ["Claude Code", "GitHub", "Jest config"],
  },
];

function PackCard({ name, tagline, tag, ingredients }: (typeof packs)[number]) {
  return (
    <Card className="flex flex-col transition-colors hover:bg-muted/40">
      <CardContent className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-sm font-bold uppercase text-foreground">
            {name.slice(0, 2)}
          </div>
          {tag && (
            <Badge variant={tag === "Popular" ? "accent" : "info"} size="sm">
              {tag}
            </Badge>
          )}
        </div>
        <p className="mt-3 text-sm font-semibold text-foreground">{name}</p>
        <p className="mt-0.5 flex-1 text-sm text-muted-foreground">{tagline}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {ingredients.map((ing) => (
            <Badge key={ing} variant="muted" className="text-xs">
              {ing}
            </Badge>
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-4 self-start">
          Use kit
          <ArrowRight size={16} />
        </Button>
      </CardContent>
    </Card>
  );
}

function SpotlightCard({ pack }: { pack: (typeof packs)[number] }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-6 p-6">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-lg font-bold text-primary">
          {pack.name.slice(0, 2)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-lg font-semibold text-foreground">{pack.name}</p>
            <Badge variant="accent" size="sm">
              Featured
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{pack.tagline}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {pack.ingredients.map((ing) => (
              <Badge key={ing} variant="muted" className="text-xs">
                {ing}
              </Badge>
            ))}
          </div>
        </div>
        <Button>
          Use kit
          <ArrowRight size={16} />
        </Button>
      </CardContent>
    </Card>
  );
}

export const Populated: Story = {
  render: () => (
    <PageShell activeNav="starter-kits">
      <PageHeader
        title="Starter Kits"
        description="Pre-configured agent templates to help you get started quickly."
        actions={
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input placeholder="Search kits..." className="w-[240px] pl-9" />
            </div>
            <Button variant="outline">
              <Add size={16} />
              Start from scratch
            </Button>
          </div>
        }
      />

      <div className="mb-6">
        <Tabs
          tabs={categories}
          value="all"
          onValueChange={() => {}}
          variant="pill"
          size="sm"
          ariaLabel="Kit categories"
        />
      </div>

      <SpotlightCard pack={packs[0]} />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {packs.slice(1).map((pack) => (
          <PackCard key={pack.name} {...pack} />
        ))}
      </div>
    </PageShell>
  ),
};

export const Empty: Story = {
  render: () => (
    <PageShell activeNav="starter-kits">
      <PageHeader
        title="Starter Kits"
        description="Pre-configured agent templates to help you get started quickly."
      />

      <PageEmptyState
        title="No starter kits available"
        message="Starter kits are pre-configured agent templates that help you get started quickly. Check back soon or create an agent from scratch."
        actionLabel="Create agent from scratch"
        actionIcon={<Add size={16} />}
        onAction={() => {}}
      />
    </PageShell>
  ),
};

export const SearchNoResults: Story = {
  name: "Search (no results)",
  render: () => (
    <PageShell activeNav="starter-kits">
      <PageHeader
        title="Starter Kits"
        description="Pre-configured agent templates to help you get started quickly."
        actions={
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value="kubernetes"
              placeholder="Search kits..."
              className="w-[240px] pl-9"
              readOnly
            />
          </div>
        }
      />
      <div className="mt-12 text-center">
        <p className="text-sm text-muted-foreground">
          No starter kits match "kubernetes"
        </p>
      </div>
    </PageShell>
  ),
};
