import {
  ArrowLeft,
  ChartBubble,
  ChartNetwork,
  ChartRelationship,
  ChartScatter,
  DataVis_1,
  DataVis_2,
  DataVis_3,
  DataVis_4,
  Diagram,
  Flow,
  GraphicalDataFlow,
  Report,
  SankeyDiagram,
  TreeView,
} from "@carbon/icons-react";
import type { ComponentType, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../store.js";

interface IconOption {
  name: string;
  icon: ComponentType<{ size: number; className?: string }>;
  note: string;
}

const OPTIONS: IconOption[] = [
  {
    name: "ChartNetwork",
    icon: ChartNetwork,
    note: "Current pick — connected node graph",
  },
  {
    name: "DataVis_1",
    icon: DataVis_1,
    note: "Abstract data visualisation glyph",
  },
  {
    name: "DataVis_2",
    icon: DataVis_2,
    note: "Scatter/plot variant",
  },
  {
    name: "DataVis_3",
    icon: DataVis_3,
    note: "Layered data variant",
  },
  {
    name: "DataVis_4",
    icon: DataVis_4,
    note: "Radial data variant",
  },
  {
    name: "ChartRelationship",
    icon: ChartRelationship,
    note: "Entity relationship lines",
  },
  {
    name: "Diagram",
    icon: Diagram,
    note: "Generic diagram / blueprint",
  },
  {
    name: "Flow",
    icon: Flow,
    note: "Flowchart / pipeline",
  },
  {
    name: "GraphicalDataFlow",
    icon: GraphicalDataFlow,
    note: "Graphical data pipeline",
  },
  {
    name: "TreeView",
    icon: TreeView,
    note: "Hierarchical tree structure",
  },
  {
    name: "ChartBubble",
    icon: ChartBubble,
    note: "Bubble chart — clustered circles",
  },
  {
    name: "ChartScatter",
    icon: ChartScatter,
    note: "Scatter plot dots",
  },
  {
    name: "SankeyDiagram",
    icon: SankeyDiagram,
    note: "Sankey / flow-weighted diagram",
  },
  {
    name: "Report",
    icon: Report,
    note: "Report / document with chart",
  },
];

function IconCard({ opt }: { opt: IconOption }) {
  const Icon = opt.icon;
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon size={16} />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">
          {opt.name}
        </span>
        <span className="text-sm text-muted-foreground">{opt.note}</span>
      </div>
    </div>
  );
}

export function IconSampler() {
  const setView = useStore((s) => s.setView);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setView("chat")}
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-base font-semibold text-foreground">
          Artifact icon options
        </h1>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto flex max-w-[640px] flex-col gap-3">
          <p className="mb-4 text-sm text-muted-foreground">
            Candidate icons for the Artifacts toggle button in the chat header.
            All shown at 16x16.
          </p>
          {OPTIONS.map((opt) => (
            <IconCard key={opt.name} opt={opt} />
          ))}
        </div>
      </div>
    </div>
  );
}
