import {
  Activity,
  ChevronDown,
  ChevronUp,
  Chip,
  Close,
  ContainerSoftware,
  Meter,
} from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LayoutOption = "status-bar" | "sidebar-footer" | "top-strip" | "floating";

const OPTIONS: { id: LayoutOption; label: string; description: string }[] = [
  {
    id: "status-bar",
    label: "Option A — Bottom Status Bar",
    description:
      "A thin bar at the very bottom of the viewport (like VS Code). Always visible, minimal footprint.",
  },
  {
    id: "sidebar-footer",
    label: "Option B — Sidebar Footer Section",
    description:
      "Metrics live at the bottom of an expanded sidebar. Collapsed sidebar shows compact sparklines.",
  },
  {
    id: "top-strip",
    label: "Option C — Top Metrics Strip",
    description:
      "A slim horizontal strip above the main content area. Pairs well with breadcrumbs.",
  },
  {
    id: "floating",
    label: "Option D — Floating Panel",
    description:
      "A dismissible/collapsible floating card anchored to a corner. Expandable for detail.",
  },
];

export function MetricsPlacementShowcase() {
  const [active, setActive] = useState<LayoutOption>("status-bar");

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-[24px] font-semibold text-foreground">
          Metrics Placement Options
        </h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          CPU and memory need to be visible at all times. The icon rail is too
          narrow. Here are 4 layout approaches — toggle between them.
        </p>
      </div>

      {/* Option selector */}
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((opt) => (
          <Button
            key={opt.id}
            variant={active === opt.id ? "default" : "outline"}
            size="sm"
            onClick={() => setActive(opt.id)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {/* Description */}
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <p className="text-[14px] text-foreground font-medium">
          {OPTIONS.find((o) => o.id === active)?.label}
        </p>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {OPTIONS.find((o) => o.id === active)?.description}
        </p>
      </div>

      {/* Preview area */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-background shadow-sm">
        {active === "status-bar" && <StatusBarPreview />}
        {active === "sidebar-footer" && <SidebarFooterPreview />}
        {active === "top-strip" && <TopStripPreview />}
        {active === "floating" && <FloatingPreview />}
      </div>
    </div>
  );
}

/* ─── Fake metric data ─── */

function CpuBar({ value = 34 }: { value?: number }) {
  return (
    <div className="flex items-center gap-2">
      <Chip size={14} className="shrink-0 text-muted-foreground" />
      <span className="text-[14px] font-medium text-foreground">{value}%</span>
      <div className="h-[6px] w-[48px] rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function MemBar({ used = 2.1, total = 4.0 }: { used?: number; total?: number }) {
  const pct = (used / total) * 100;
  return (
    <div className="flex items-center gap-2">
      <Activity size={14} className="shrink-0 text-muted-foreground" />
      <span className="text-[14px] font-medium text-foreground">
        {used.toFixed(1)}/{total.toFixed(0)} GB
      </span>
      <div className="h-[6px] w-[48px] rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ─── Option A: Bottom Status Bar ─── */

function StatusBarPreview() {
  return (
    <div className="flex h-[480px] flex-col">
      {/* Fake app layout */}
      <div className="flex flex-1 min-h-0">
        <FakeSidebar />
        <FakeMainContent />
      </div>
      {/* Status bar */}
      <div className="flex h-[28px] shrink-0 items-center justify-between border-t border-border bg-card px-4">
        <div className="flex items-center gap-5">
          <CpuBar value={34} />
          <MemBar used={2.1} total={4.0} />
        </div>
        <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-emerald-500" />
            3 sandboxes running
          </span>
          <span>Budget: 72% remaining</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Option B: Sidebar Footer Section ─── */

function SidebarFooterPreview() {
  return (
    <div className="flex h-[480px]">
      {/* Sidebar with metrics footer */}
      <div className="flex w-[240px] flex-col border-r border-border bg-card">
        <div className="flex items-center px-3 pt-3 pb-2">
          <div className="size-8 rounded-lg bg-muted" />
        </div>
        <div className="flex flex-col gap-0.5 px-2">
          <FakeNavItem label="Sandboxes" active />
          <FakeNavItem label="Experiments" />
          <FakeNavItem label="Knowledge bases" />
        </div>
        <div className="flex-1" />
        {/* Metrics section */}
        <div className="border-t border-border px-3 py-3 space-y-2.5">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            Resources
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Chip size={14} className="text-muted-foreground" />
                <span className="text-[14px] text-foreground">CPU</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-medium text-foreground">34%</span>
                <div className="h-[6px] w-[56px] rounded-full bg-muted overflow-hidden">
                  <div className="h-full w-[34%] rounded-full bg-accent" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-muted-foreground" />
                <span className="text-[14px] text-foreground">Memory</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-medium text-foreground">2.1 GB</span>
                <div className="h-[6px] w-[56px] rounded-full bg-muted overflow-hidden">
                  <div className="h-full w-[52%] rounded-full bg-emerald-500" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="px-2 pb-2">
          <FakeNavItem label="Settings" />
        </div>
      </div>
      <FakeMainContent />
    </div>
  );
}

/* ─── Option C: Top Metrics Strip ─── */

function TopStripPreview() {
  return (
    <div className="flex h-[480px]">
      <FakeSidebar />
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top strip */}
        <div className="flex h-[40px] items-center justify-between border-b border-border bg-card/60 px-5">
          <div className="flex items-center gap-2 text-[14px] text-muted-foreground">
            <ContainerSoftware size={14} />
            <span>Sandboxes</span>
            <span className="text-border">/</span>
            <span className="text-foreground font-medium">claude-code-main</span>
          </div>
          <div className="flex items-center gap-5">
            <CpuBar value={34} />
            <MemBar used={2.1} total={4.0} />
          </div>
        </div>
        <FakeMainContentInner />
      </div>
    </div>
  );
}

/* ─── Option D: Floating Panel ─── */

function FloatingPreview() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-[480px]">
      <FakeSidebar />
      <div className="relative flex-1">
        <FakeMainContent />
        {/* Floating card */}
        <div className="absolute bottom-4 right-4 z-10">
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-lg transition-all hover:shadow-xl"
            >
              <Chip size={14} className="text-accent" />
              <span className="text-[14px] font-medium text-foreground">34%</span>
              <span className="mx-1 h-3 w-px bg-border" />
              <Activity size={14} className="text-emerald-500" />
              <span className="text-[14px] font-medium text-foreground">2.1 GB</span>
              <ChevronUp size={14} className="text-muted-foreground ml-1" />
            </button>
          ) : (
            <div className="w-[240px] rounded-xl border border-border bg-card p-4 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[14px] font-semibold text-foreground">
                  System Resources
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCollapsed(true)}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Close size={14} />
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <Chip size={14} className="text-muted-foreground" />
                      <span className="text-[14px] text-muted-foreground">CPU</span>
                    </div>
                    <span className="text-[14px] font-medium text-foreground">34%</span>
                  </div>
                  <div className="h-[6px] w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full w-[34%] rounded-full bg-accent" />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <Activity size={14} className="text-muted-foreground" />
                      <span className="text-[14px] text-muted-foreground">Memory</span>
                    </div>
                    <span className="text-[14px] font-medium text-foreground">
                      2.1 / 4 GB
                    </span>
                  </div>
                  <div className="h-[6px] w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full w-[52%] rounded-full bg-emerald-500" />
                  </div>
                </div>
                <div className="pt-1 border-t border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-muted-foreground">
                      3 sandboxes running
                    </span>
                    <span className="flex items-center gap-1 text-[12px] text-emerald-600">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      Healthy
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Shared fake UI pieces ─── */

function FakeSidebar() {
  return (
    <div className="flex w-[56px] flex-col items-center border-r border-border bg-card py-3 gap-2">
      <div className="size-8 rounded-lg bg-muted" />
      <div className="mt-2 size-8 rounded-lg bg-primary/10" />
      <div className="size-8 rounded-lg bg-muted" />
      <div className="size-8 rounded-lg bg-muted" />
      <div className="flex-1" />
      <div className="size-8 rounded-lg bg-muted" />
      <div className="size-8 rounded-lg bg-muted" />
    </div>
  );
}

function FakeNavItem({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[14px]",
        active
          ? "bg-muted text-primary font-medium"
          : "text-foreground/70",
      )}
    >
      <div className="size-[18px] rounded bg-current opacity-30" />
      {label}
    </div>
  );
}

function FakeMainContent() {
  return (
    <div className="flex-1 p-6">
      <FakeMainContentInner />
    </div>
  );
}

function FakeMainContentInner() {
  return (
    <div className="p-6 space-y-4">
      <div className="h-6 w-[180px] rounded bg-muted" />
      <div className="h-4 w-[300px] rounded bg-muted/60" />
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="h-[100px] rounded-lg border border-border bg-muted/30" />
        <div className="h-[100px] rounded-lg border border-border bg-muted/30" />
        <div className="h-[100px] rounded-lg border border-border bg-muted/30" />
        <div className="h-[100px] rounded-lg border border-border bg-muted/30" />
      </div>
    </div>
  );
}
