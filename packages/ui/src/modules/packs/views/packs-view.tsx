import { useState } from "react";

import { cn } from "@/lib/utils";

import { PackDetailSheet } from "../components/pack-detail-sheet.js";
import { type Pack, PACK_CATEGORIES, PACKS } from "../data/packs.js";

const ACCENT_TEXT: Record<Pack["accent"], string> = {
  blue: "text-blue-400",
  violet: "text-violet-400",
  amber: "text-amber-400",
  emerald: "text-emerald-400",
  rose: "text-rose-400",
  cyan: "text-cyan-400",
};

function ReqPills({ pack }: { pack: Pack }) {
  const conns = pack.requirements.filter((r) => r.type === "connection").length;
  const skills = pack.requirements.filter((r) => r.type === "skill").length;
  const kbs = pack.requirements.filter(
    (r) => r.type === "knowledge-base",
  ).length;
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {conns > 0 && (
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          {conns} conn
        </span>
      )}
      {skills > 0 && (
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
          {skills} skill
        </span>
      )}
      {kbs > 0 && (
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          {kbs} KB
        </span>
      )}
    </div>
  );
}

function ImagePlaceholder({ className }: { className?: string }) {
  return <div className={cn("rounded-xl bg-muted", className)} />;
}

function SpotlightLayout({
  packs,
  onSelect,
}: {
  packs: Pack[];
  onSelect: (p: Pack) => void;
}) {
  if (packs.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No packs in this category yet.
      </p>
    );
  }

  const [hero, ...rest] = packs;

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => onSelect(hero!)}
        className="group grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-card text-left transition-colors hover:border-foreground/20"
      >
        <ImagePlaceholder className="min-h-[280px]" />
        <div className="flex flex-col justify-center p-10">
          <p
            className={cn(
              "text-xs font-semibold uppercase tracking-wider",
              ACCENT_TEXT[hero!.accent],
            )}
          >
            Featured
          </p>
          <h3 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {hero!.name}
          </h3>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            {hero!.description}
          </p>
          <div className="mt-5">
            <ReqPills pack={hero!} />
          </div>
        </div>
      </button>

      {rest.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {rest.map((pack) => (
            <button
              key={pack.id}
              type="button"
              onClick={() => onSelect(pack)}
              className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-foreground/20"
            >
              <ImagePlaceholder className="h-36 w-full" />
              <div className="flex flex-1 flex-col p-5">
                <p
                  className={cn(
                    "text-xs font-semibold uppercase tracking-wider",
                    ACCENT_TEXT[pack.accent],
                  )}
                >
                  {pack.category}
                </p>
                <h4 className="mt-1.5 text-base font-bold text-foreground">
                  {pack.name}
                </h4>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {pack.tagline}
                </p>
                <div className="mt-4">
                  <ReqPills pack={pack} />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PacksView() {
  const [activeCategory, setActiveCategory] = useState<
    (typeof PACK_CATEGORIES)[number] | "All"
  >("All");
  const [selectedPack, setSelectedPack] = useState<Pack | null>(null);

  const filtered =
    activeCategory === "All"
      ? PACKS
      : PACKS.filter((p) => p.category === activeCategory);

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Packs
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pre-configured agent setups — connections, skills, and knowledge bases
          bundled and ready to use.
        </p>
      </div>

      <div className="mb-6 flex gap-1 rounded-lg border border-border bg-muted/50 p-1">
        {(["All", ...PACK_CATEGORIES] as const).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              activeCategory === cat
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      <SpotlightLayout packs={filtered} onSelect={setSelectedPack} />

      <PackDetailSheet
        pack={selectedPack}
        onClose={() => setSelectedPack(null)}
      />
    </>
  );
}
