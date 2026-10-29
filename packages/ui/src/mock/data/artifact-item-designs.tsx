import {
  Close,
  Code,
  Dashboard,
  Document,
  Locked,
  OverflowMenuVertical,
  Share,
} from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

/* ─── Shared data ─── */

const ITEMS = [
  { title: "Landing page", kind: "html", visibility: "public" as const },
  { title: "Dashboard component", kind: "jsx", visibility: "private" as const },
  { title: "API reference", kind: "markdown", visibility: "private" as const },
  { title: "Onboarding flow", kind: "html", visibility: "public" as const },
  { title: "Design tokens", kind: "json", visibility: "private" as const },
];

function KindIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "html":
      return <Code size={14} className="shrink-0 text-muted-foreground" />;
    case "jsx":
      return <Dashboard size={14} className="shrink-0 text-muted-foreground" />;
    default:
      return <Document size={14} className="shrink-0 text-muted-foreground" />;
  }
}

function VisIcon({ visibility }: { visibility: "public" | "private" }) {
  return visibility === "public" ? (
    <Share size={12} className="shrink-0 text-muted-foreground" />
  ) : (
    <Locked size={12} className="shrink-0 text-muted-foreground" />
  );
}

function KindLabel({ kind }: { kind: string }) {
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {kind.charAt(0).toUpperCase() + kind.slice(1)}
    </span>
  );
}

function PanelShell({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-[320px] flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-sm font-semibold text-foreground">Artifacts</span>
        <span className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Close size={16} />
          </button>
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
      <div className="border-t border-border px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {note && (
          <p className="mt-0.5 text-[11px] text-muted-foreground/70">{note}</p>
        )}
      </div>
    </div>
  );
}

/* ─── 1: Current card design (baseline) ─── */

function Option1() {
  return (
    <PanelShell
      label="Option 1 — Card (current)"
      note="Bordered cards, two-line layout with kind · visibility"
    >
      <div className="flex flex-col gap-2 px-1.5 py-1">
        {ITEMS.map((a) => (
          <button
            key={a.title}
            type="button"
            className="group/item flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-muted/40"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center">
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {a.title}
                </span>
                <span className="ml-auto shrink-0">
                  <OverflowMenuVertical
                    size={16}
                    className="text-foreground opacity-0 transition-opacity group-hover/item:opacity-100"
                  />
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                {a.kind.charAt(0).toUpperCase() + a.kind.slice(1)}
                <span className="mx-0.5">·</span>
                <VisIcon visibility={a.visibility} />
                {a.visibility === "public" ? "Public" : "Private"}
              </span>
            </span>
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

/* ─── 2: Flat row — icon, name, kind + vis right-aligned ─── */

function Option2() {
  return (
    <PanelShell
      label="Option 2 — Flat row"
      note="File-tree density. Icon → name → kind label → visibility icon"
    >
      <div className="flex flex-col gap-0.5 px-1.5 py-1">
        {ITEMS.map((a) => (
          <button
            key={a.title}
            type="button"
            className="group/item flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60"
          >
            <KindIcon kind={a.kind} />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {a.title}
            </span>
            <KindLabel kind={a.kind} />
            <VisIcon visibility={a.visibility} />
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

/* ─── 3: Flat row with overflow dots on hover ─── */

function Option3() {
  return (
    <PanelShell
      label="Option 3 — Flat row + hover dots"
      note="Like Option 2 but overflow menu appears on hover, pushing visibility aside"
    >
      <div className="flex flex-col gap-0.5 px-1.5 py-1">
        {ITEMS.map((a) => (
          <button
            key={a.title}
            type="button"
            className="group/item flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60"
          >
            <KindIcon kind={a.kind} />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {a.title}
            </span>
            <span className="flex items-center gap-1.5 group-hover/item:hidden">
              <KindLabel kind={a.kind} />
              <VisIcon visibility={a.visibility} />
            </span>
            <OverflowMenuVertical
              size={16}
              className="hidden shrink-0 text-muted-foreground group-hover/item:block"
            />
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

/* ─── 4: Two-line flat row — name top, kind · vis bottom ─── */

function Option4() {
  return (
    <PanelShell
      label="Option 4 — Two-line flat"
      note="No border, no card background. Name on top, metadata below. Comfortable density."
    >
      <div className="flex flex-col gap-0.5 px-1.5 py-1">
        {ITEMS.map((a) => (
          <button
            key={a.title}
            type="button"
            className="group/item flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60"
          >
            <KindIcon kind={a.kind} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">
                {a.title}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {a.kind.charAt(0).toUpperCase() + a.kind.slice(1)}
                <span className="mx-0.5">·</span>
                {a.visibility === "public" ? "Public" : "Private"}
              </span>
            </span>
            <OverflowMenuVertical
              size={16}
              className="shrink-0 text-foreground opacity-0 transition-opacity group-hover/item:opacity-100"
            />
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

/* ─── 5: Compact card — subtle bg, no border ─── */

function Option5() {
  return (
    <PanelShell
      label="Option 5 — Soft card"
      note="Card with muted background instead of border. More visual grouping, less chrome."
    >
      <div className="flex flex-col gap-1.5 px-1.5 py-1">
        {ITEMS.map((a) => (
          <button
            key={a.title}
            type="button"
            className="group/item flex w-full items-center gap-2.5 rounded-lg bg-muted/40 px-2.5 py-2 text-left transition-colors hover:bg-muted/70"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center">
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {a.title}
                </span>
                <OverflowMenuVertical
                  size={16}
                  className="ml-auto shrink-0 text-foreground opacity-0 transition-opacity group-hover/item:opacity-100"
                />
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                {a.kind.charAt(0).toUpperCase() + a.kind.slice(1)}
                <span className="mx-0.5">·</span>
                <VisIcon visibility={a.visibility} />
                {a.visibility === "public" ? "Public" : "Private"}
              </span>
            </span>
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

/* ─── 6: Single-line with badge pill ─── */

function Option6() {
  return (
    <PanelShell
      label="Option 6 — Row with badge"
      note="Flat row with a small pill for kind. Visibility icon at far right."
    >
      <div className="flex flex-col gap-0.5 px-1.5 py-1">
        {ITEMS.map((a) => (
          <button
            key={a.title}
            type="button"
            className="group/item flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60"
          >
            <span className="min-w-0 flex-1 truncate text-foreground">
              {a.title}
            </span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {a.kind.toUpperCase()}
            </span>
            <VisIcon visibility={a.visibility} />
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

/* ─── 7: Icon-left card with colored kind stripe ─── */

function Option7() {
  const stripeColor: Record<string, string> = {
    html: "bg-blue-500",
    jsx: "bg-violet-500",
    markdown: "bg-emerald-500",
    json: "bg-amber-500",
  };
  return (
    <PanelShell
      label="Option 7 — Stripe card"
      note="Left color stripe indicates kind. Compact card with border."
    >
      <div className="flex flex-col gap-1.5 px-1.5 py-1">
        {ITEMS.map((a) => (
          <button
            key={a.title}
            type="button"
            className="group/item flex w-full items-center gap-0 overflow-hidden rounded-lg border border-border text-left transition-colors hover:bg-muted/40"
          >
            <span
              className={cn(
                "h-full w-1 shrink-0 self-stretch",
                stripeColor[a.kind] ?? "bg-muted-foreground",
              )}
            />
            <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {a.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {a.kind.charAt(0).toUpperCase() + a.kind.slice(1)}
                </span>
              </span>
              <VisIcon visibility={a.visibility} />
              <OverflowMenuVertical
                size={16}
                className="shrink-0 text-foreground opacity-0 transition-opacity group-hover/item:opacity-100"
              />
            </span>
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

/* ─── 8: Grid / thumbnail cards ─── */

function Option8() {
  return (
    <PanelShell
      label="Option 8 — Thumbnail grid"
      note="2-column grid with preview thumbnails. Suits visual artifacts (HTML, JSX)."
    >
      <div className="grid grid-cols-2 gap-2 px-2 py-2">
        {ITEMS.map((a) => (
          <button
            key={a.title}
            type="button"
            className="group/item flex flex-col overflow-hidden rounded-lg border border-border text-left transition-colors hover:bg-muted/40"
          >
            <span className="flex h-20 items-center justify-center bg-muted/30">
              <KindIcon kind={a.kind} />
            </span>
            <span className="flex flex-col gap-0.5 px-2 py-1.5">
              <span className="truncate text-xs font-medium text-foreground">
                {a.title}
              </span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <KindLabel kind={a.kind} />
                <VisIcon visibility={a.visibility} />
              </span>
            </span>
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

/* ─── 9: Minimal — name only, metadata on hover ─── */

function Option9() {
  return (
    <PanelShell
      label="Option 9 — Minimal hover-reveal"
      note="Only the name is visible. Kind and visibility appear on hover."
    >
      <div className="flex flex-col gap-0.5 px-1.5 py-1">
        {ITEMS.map((a) => (
          <button
            key={a.title}
            type="button"
            className="group/item flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted/60"
          >
            <KindIcon kind={a.kind} />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {a.title}
            </span>
            <span className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover/item:opacity-100">
              <KindLabel kind={a.kind} />
              <VisIcon visibility={a.visibility} />
              <OverflowMenuVertical
                size={16}
                className="text-muted-foreground"
              />
            </span>
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

/* ─── 10: Grouped by kind ─── */

function Option10() {
  const grouped = ITEMS.reduce<Record<string, typeof ITEMS>>((acc, item) => {
    (acc[item.kind] ??= []).push(item);
    return acc;
  }, {});

  return (
    <PanelShell
      label="Option 10 — Grouped by kind"
      note="Artifacts sorted under kind headings. Flat rows within each group."
    >
      <div className="flex flex-col py-1">
        {Object.entries(grouped).map(([kind, items]) => (
          <div key={kind}>
            <div className="px-3 pt-2 pb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {kind}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 px-1.5">
              {items.map((a) => (
                <button
                  key={a.title}
                  type="button"
                  className="group/item flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {a.title}
                  </span>
                  <VisIcon visibility={a.visibility} />
                  <OverflowMenuVertical
                    size={16}
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/item:opacity-100"
                  />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

/* ─── Page ─── */

export function ArtifactItemDesigns() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-foreground">
          Artifact Item Designs
        </h1>
        <p className="text-sm text-muted-foreground">
          Ten approaches for rendering artifact items in the panel. Each panel
          shows the same five artifacts.
        </p>
      </div>
      <div className="flex flex-wrap gap-6">
        <Option1 />
        <Option2 />
        <Option3 />
        <Option4 />
        <Option5 />
        <Option6 />
        <Option7 />
        <Option8 />
        <Option9 />
        <Option10 />
      </div>
    </div>
  );
}
