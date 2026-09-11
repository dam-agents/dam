import { Launch } from "@carbon/icons-react";
import type { ConnectionTemplateView, StarterKitView } from "api-server-api";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { useConnectionTemplates } from "../../connections/api/queries.js";
import { useStarterKits } from "../api/queries.js";
import { describeAccepts, shortKitVersion } from "../lib/setup.js";

const CATEGORY_LABEL: Record<StarterKitView["category"], string> = {
  knowledge: "Knowledge",
  software: "Software",
  productivity: "Productivity",
  research: "Research",
};

function needsLines(
  kit: StarterKitView,
  templateById: ReadonlyMap<string, ConnectionTemplateView>,
): string[] {
  const lines: string[] = [];
  for (const req of kit.connections) {
    lines.push(
      `${req.required ? "Requires" : "Suggests"} a ${describeAccepts(req.accepts, templateById)} connection`,
    );
  }
  for (const ch of kit.channels) lines.push(`Suggests a ${ch.type} channel`);
  const asks = kit.parameters.filter((p) => p.required).map((p) => p.name);
  if (asks.length > 0) lines.push(`Asks you for: ${asks.join(", ")}`);
  return lines;
}

function createsLines(kit: StarterKitView): string[] {
  const lines: string[] = [];
  lines.push(
    kit.template
      ? `An agent on the ${kit.template} image`
      : "An agent on the harness you pick",
  );
  if (kit.schedules.length > 0) {
    const on = kit.schedules.filter((s) => s.enabled).length;
    lines.push(
      `${kit.schedules.length} schedule${kit.schedules.length === 1 ? "" : "s"} (${on} enabled)`,
    );
  }
  if (kit.seed) lines.push("Its definition, cloned during onboarding");
  return lines;
}

function KitCard({
  kit,
  templateById,
}: {
  kit: StarterKitView;
  templateById: ReadonlyMap<string, ConnectionTemplateView>;
}) {
  const navigateToStarterKitSetup = useStore(
    (s) => s.navigateToStarterKitSetup,
  );
  return (
    <Card className="flex flex-col" data-testid={`starter-kit-card-${kit.id}`}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{kit.name}</CardTitle>
          <Badge variant="template">{CATEGORY_LABEL[kit.category]}</Badge>
        </div>
        <CardDescription>{kit.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4 text-sm">
        <div>
          <div className="mb-1 font-medium">What it needs</div>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {needsLines(kit, templateById).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 font-medium">What it creates</div>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {createsLines(kit).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-2">
        <span
          className="min-w-0 truncate font-mono text-xs text-muted-foreground"
          title={`${kit.id}@${kit.version}`}
        >
          {kit.id}@{shortKitVersion(kit.version)}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {kit.docsUrl && (
            <Button asChild variant="ghost" size="sm">
              <a href={kit.docsUrl} target="_blank" rel="noreferrer">
                Docs <Launch size={14} />
              </a>
            </Button>
          )}
          <Button size="sm" onClick={() => navigateToStarterKitSetup(kit.id)}>
            Use this kit
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export function StarterKitsView() {
  const kits = useStarterKits();
  const templates = useConnectionTemplates();
  const templateById = useMemo(
    () => new Map((templates.data ?? []).map((t) => [t.id, t])),
    [templates.data],
  );
  const setView = useStore((s) => s.setView);

  return (
    <div>
      <PageHeader
        title="Starter kits"
        description="A starter kit is a proven way of working, applied to a new agent: the connections, schedules and setup a job needs, with onboarding that asks only for what you alone can supply."
        actions={
          <Button variant="outline" onClick={() => setView("coding-agent-new")}>
            Start with a plain agent
          </Button>
        }
      />

      {kits.isLoading && <ListSkeleton rows={2} rowHeight={220} />}

      {kits.data && kits.data.length === 0 && (
        <PageEmptyState
          title="No starter kits in this catalog"
          message="This install has no starter kit catalog configured, or the catalog lists no kits. You can still start with a plain agent."
          actionLabel="Start with a plain agent"
          onAction={() => setView("coding-agent-new")}
        />
      )}

      {kits.data && kits.data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {kits.data.map((kit) => (
            <KitCard key={kit.id} kit={kit} templateById={templateById} />
          ))}
        </div>
      )}
    </div>
  );
}
