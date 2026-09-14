import { ArrowRight } from "@carbon/icons-react";
import type { StarterKitView } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useStarterKits } from "../api/queries.js";

const TOP_KITS = 4;

const CATEGORY_LABEL: Record<StarterKitView["category"], string> = {
  knowledge: "Knowledge",
  software: "Software",
  productivity: "Productivity",
  research: "Research",
};

export function StarterKitsWidget() {
  const kits = useStarterKits();
  const setView = useStore((s) => s.setView);
  const navigateToStarterKitSetup = useStore(
    (s) => s.navigateToStarterKitSetup,
  );

  if (!kits.data || kits.data.length === 0) return null;
  const shown = kits.data.slice(0, TOP_KITS);

  return (
    <div
      className="flex flex-col rounded-2xl border border-border bg-card p-6"
      data-testid="starter-kits-widget"
    >
      <div className="mb-3 flex min-h-[32px] items-center justify-between">
        <p className="text-sm text-muted-foreground">Start from a kit</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setView("starter-kits")}
        >
          All kits <ArrowRight size={14} />
        </Button>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {shown.map((kit) => (
          <li key={kit.id} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{kit.name}</span>
                <Badge variant="template" size="sm">
                  {CATEGORY_LABEL[kit.category]}
                </Badge>
              </div>
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                {kit.description}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigateToStarterKitSetup(kit.id)}
              data-testid={`starter-kits-widget-use-${kit.id}`}
            >
              Use
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
