import { Chemistry, DataBase, Flash, Pen } from "@carbon/icons-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

interface OnboardLandingProps {
  onSelect: (choice: "create" | "demo") => void;
  variant: "experiment" | "knowledge-base";
}

const COPY = {
  experiment: {
    headline: "Experiments",
    subtitle:
      "Run optimization loops across frameworks — go deep with one, or horse-race several to find what works.",
    createTitle: "Start your own",
    createDescription: "Define a goal and pick frameworks to run",
    demoTitle: "Load an example",
    demoDescription: "Watch a NOUS experiment evolve a solution live",
    icon: <Chemistry size={16} />,
  },
  "knowledge-base": {
    headline: "Knowledge Bases",
    subtitle:
      "Point me at sources — repos, docs, URLs — and I'll build structured, interlinked wiki pages you can query.",
    createTitle: "Start your own",
    createDescription: "Name it and tell me what it covers",
    demoTitle: "Load an example",
    demoDescription: "Explore a Greek Mythology wiki to see how it works",
    icon: <DataBase size={16} />,
  },
};

export function OnboardLanding({ onSelect, variant }: OnboardLandingProps) {
  const copy = COPY[variant];
  const [selected, setSelected] = useState<"create" | "demo" | null>(null);

  function handleSelect(choice: "create" | "demo") {
    setSelected(choice);
    setTimeout(() => onSelect(choice), 280);
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center min-h-[65vh] px-6",
        "animate-in fade-in duration-700 fill-mode-both",
        selected && "animate-out fade-out duration-200",
      )}
    >
      <div className="w-full max-w-[420px] space-y-10">
        {/* Icon + headline */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="relative flex size-14 items-center justify-center rounded-2xl border border-border/40 bg-gradient-to-b from-card to-muted/50 text-foreground shadow-sm">
            {copy.icon}
            <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-b from-foreground/[0.03] to-transparent pointer-events-none" />
          </div>
          <div className="space-y-2.5">
            <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-foreground">
              {copy.headline}
            </h1>
            <p className="text-[14px] leading-[1.6] text-muted-foreground max-w-[340px] mx-auto">
              {copy.subtitle}
            </p>
          </div>
        </div>

        {/* Choice cards */}
        <div className="space-y-3">
          <LandingCard
            icon={<Pen size={16} />}
            title={copy.createTitle}
            description={copy.createDescription}
            selected={selected === "create"}
            onClick={() => handleSelect("create")}
          />
          <LandingCard
            icon={<Flash size={16} />}
            title={copy.demoTitle}
            description={copy.demoDescription}
            selected={selected === "demo"}
            onClick={() => handleSelect("demo")}
          />
        </div>
      </div>
    </div>
  );
}

function LandingCard({
  icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all duration-200",
        selected
          ? "border-foreground bg-card shadow-lg"
          : "border-border bg-gradient-to-br from-muted/60 to-card hover:shadow-lg",
      )}
    >
      <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-[#dde1e6] bg-background/80">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
          {description}
        </p>
      </div>
      <span className="text-muted-foreground/20 transition-all duration-200 group-hover:text-foreground group-hover:translate-x-0.5">
        →
      </span>
    </button>
  );
}
