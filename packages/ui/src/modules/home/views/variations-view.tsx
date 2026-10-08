import { Chemistry, Folders, Time } from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  Play,
  Zap,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { usePendingApprovals } from "../../approvals/api/queries.js";

/* ═══════════════════════════════════════════════════════════════════════════
   VARIATIONS VIEW — 5 wild design explorations
   Same content, dramatically different visual treatments.
   ═══════════════════════════════════════════════════════════════════════════ */

const VARIATION_NAMES = [
  "Glassmorphism",
  "Neon Noir",
  "Bento Grid",
  "Gradient Mesh",
  "Brutalist",
] as const;

type VariationName = (typeof VARIATION_NAMES)[number];

export function VariationsView() {
  const [activeVariation, setActiveVariation] =
    useState<VariationName>("Glassmorphism");
  const { data: pendingApprovals } = usePendingApprovals();
  const approvals = useMemo(() => pendingApprovals ?? [], [pendingApprovals]);

  return (
    <div className="space-y-6">
      {/* Variation switcher */}
      <div className="flex items-center gap-2 flex-wrap">
        {VARIATION_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setActiveVariation(name)}
            className={cn(
              "px-4 py-2 rounded-full text-[14px] font-medium transition-all",
              activeVariation === name
                ? "bg-foreground text-background shadow-lg"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80",
            )}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Active variation */}
      {activeVariation === "Glassmorphism" && (
        <V1_Glassmorphism approvals={approvals} />
      )}
      {activeVariation === "Neon Noir" && <V2_NeonNoir approvals={approvals} />}
      {activeVariation === "Bento Grid" && (
        <V3_BentoGrid approvals={approvals} />
      )}
      {activeVariation === "Gradient Mesh" && (
        <V4_GradientMesh approvals={approvals} />
      )}
      {activeVariation === "Brutalist" && (
        <V5_Brutalist approvals={approvals} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   VARIATION 1: GLASSMORPHISM
   Frosted translucent panels, layered depth, soft luminance behind cards.
   Inspired by Apple Vision Pro UI + Linear's glass panels.
   ═══════════════════════════════════════════════════════════════════════════ */

function V1_Glassmorphism({ approvals }: { approvals: ApprovalView[] }) {
  return (
    <div className="relative min-h-screen -mx-6 -mt-6 px-6 pt-6 pb-20">
      {/* Ambient background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-32 w-96 h-96 rounded-full bg-accent/20 blur-[128px]" />
        <div className="absolute top-60 right-0 w-80 h-80 rounded-full bg-purple-500/15 blur-[100px]" />
        <div className="absolute bottom-40 left-1/3 w-72 h-72 rounded-full bg-emerald-500/10 blur-[90px]" />
      </div>

      <div className="relative z-10 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-[28px] font-bold text-foreground tracking-tight">
            Home
          </h1>
          <GlassChip label="Since last visit" />
        </div>

        {/* Blocked — frosted red */}
        {approvals.length > 0 && (
          <div className="rounded-3xl border border-white/10 bg-destructive/5 backdrop-blur-xl p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
              <h2 className="text-[16px] font-semibold text-foreground">
                Blocked
              </h2>
              <span className="text-[14px] text-muted-foreground">
                ({approvals.length})
              </span>
            </div>
            <div className="space-y-3">
              {approvals.slice(0, 2).map((a, i) => (
                <GlassApprovalCard key={i} approval={a} />
              ))}
              {approvals.length > 2 && (
                <button
                  type="button"
                  className="text-[14px] text-muted-foreground hover:text-foreground"
                >
                  +{approvals.length - 2} more
                </button>
              )}
            </div>
          </div>
        )}

        {/* Resource widgets */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <GlassPanel>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[14px] font-medium text-foreground">
                Spend today
              </span>
              <span className="text-[22px] font-bold text-foreground tabular-nums">
                $4.82
              </span>
            </div>
            <div className="h-12 rounded-lg bg-white/5 flex items-end gap-0.5 px-2 pb-1">
              {[30, 45, 20, 60, 80, 55, 40, 70, 35, 50, 65, 45].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-accent/60"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </GlassPanel>
          <GlassPanel>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[14px] font-medium text-foreground">
                Compute
              </span>
              <span className="text-[22px] font-bold text-foreground tabular-nums">
                5/8 CPU
              </span>
            </div>
            <div className="flex gap-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex-1 h-8 rounded-lg transition-all",
                    i < 3 &&
                      "bg-emerald-500/70 shadow-[0_0_6px_rgba(16,185,129,0.3)]",
                    i >= 3 && i < 5 && "bg-amber-400/60",
                    i >= 5 && "border border-white/10 bg-white/5",
                  )}
                />
              ))}
            </div>
          </GlassPanel>
        </div>

        {/* Ready for you */}
        <GlassPanel>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-semibold text-foreground">
              Ready for you
            </h2>
            <GlassChip label="All types" chevron />
          </div>
          <div className="space-y-2">
            <GlassCardRow
              icon={<Globe size={16} />}
              title="Refactor auth middleware"
              subtitle="backend-refactor · 45m ago"
              action="View"
            />
            <GlassCardRow
              icon={<Folders size={16} />}
              title="Spring campaign hero images"
              subtitle="brand-asset-generator · 2h ago"
              action="Open"
            />
            <GlassCardRow
              icon={<Time size={16} />}
              title="Daily brand audit"
              subtitle="brand-asset-generator · 6h ago"
              action="View"
            />
          </div>
          <button
            type="button"
            className="mt-3 text-[14px] text-accent hover:text-accent/80 transition-colors"
          >
            +3 more
          </button>
        </GlassPanel>

        {/* Running */}
        <GlassPanel>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-semibold text-foreground">
                Running now
              </h2>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <GlassChip label="All types" chevron />
          </div>
          <div className="space-y-2">
            <GlassCardRow
              icon={<Play size={14} />}
              title="Implement dark mode toggle"
              subtitle="frontend-agent · active 12m"
              action="Open"
              live
            />
            <GlassCardRow
              icon={<Chemistry size={16} />}
              title="Spring palette — warm vs cool"
              subtitle="color-palette-testing · 3 running"
              action="View"
              live
            />
            <GlassCardRow
              icon={<Time size={16} />}
              title="Daily brand audit"
              subtitle="Next: in 3h · Every weekday 9 AM"
              action="Edit"
            />
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}

function GlassPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6",
        "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_4px_24px_rgba(0,0,0,0.1)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function GlassChip({ label, chevron }: { label: string; chevron?: boolean }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] backdrop-blur-sm px-3 py-1.5 text-[14px] text-muted-foreground hover:text-foreground hover:bg-white/[0.08] transition-colors"
    >
      {label}
      {chevron && <ChevronDown size={14} />}
    </button>
  );
}

function GlassCardRow({
  icon,
  title,
  subtitle,
  action,
  live,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  action: string;
  live?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 hover:bg-white/[0.05] transition-colors group">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-medium text-foreground truncate">
          {title}
        </p>
        <p className="text-[14px] text-muted-foreground truncate">{subtitle}</p>
      </div>
      {live && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
      )}
      <button
        type="button"
        className="text-[14px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all"
      >
        {action}
      </button>
    </div>
  );
}

function GlassApprovalCard({ approval }: { approval: ApprovalView }) {
  const name =
    approval.payload.kind === "ext_authz" ? "Network access" : "Tool use";
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/[0.03] px-4 py-3">
      <AlertCircle size={16} className="text-destructive shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-medium text-foreground">{name}</p>
        <p className="text-[14px] text-muted-foreground truncate">
          Waiting for your decision
        </p>
      </div>
      <Button
        size="sm"
        className="rounded-full bg-foreground text-background hover:bg-foreground/90 text-[14px]"
      >
        Allow
      </Button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   VARIATION 2: NEON NOIR
   Deep black canvas, electric accent lines, glowing edges.
   Inspired by Cyberpunk/gaming dashboards + Vercel's dark aesthetic.
   ═══════════════════════════════════════════════════════════════════════════ */

function V2_NeonNoir({ approvals }: { approvals: ApprovalView[] }) {
  return (
    <div className="relative -mx-6 -mt-6 px-6 pt-6 pb-20 min-h-screen bg-[#0a0a0f]">
      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative z-10 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[32px] font-black text-white tracking-tighter">
              HOME
            </h1>
            <p className="text-[14px] text-[#666] font-mono uppercase tracking-widest">
              Agent operations center
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded border border-[#222] bg-[#111] text-[14px] text-[#888] font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            Since last visit
          </div>
        </div>

        {/* Blocked — electric red border */}
        {approvals.length > 0 && (
          <div className="relative rounded-xl border border-red-500/30 bg-[#110808] p-6 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-red-500/5 to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-red-500/80 via-red-500/40 to-transparent" />
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[14px] font-mono font-bold text-red-400 uppercase tracking-wider">
                  BLOCKED
                </span>
                <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-[14px] font-mono tabular-nums">
                  {approvals.length}
                </span>
              </div>
              <div className="space-y-2">
                {approvals.slice(0, 2).map((a, i) => (
                  <NeonApprovalRow key={i} approval={a} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-4">
          <NeonStatCard
            label="SPEND"
            value="$4.82"
            subtext="today"
            color="cyan"
          />
          <NeonStatCard
            label="COMPUTE"
            value="5/8"
            subtext="cpu active"
            color="emerald"
          />
        </div>

        {/* Running — pulsing green line */}
        <div className="relative rounded-xl border border-[#1a1a1a] bg-[#0d0d12] p-6">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-500/60 via-emerald-500/20 to-transparent" />
          <div className="flex items-center gap-3 mb-5">
            <span className="text-[14px] font-mono font-bold text-emerald-400 uppercase tracking-wider">
              RUNNING
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
          </div>
          <div className="space-y-3">
            <NeonItemRow
              title="Implement dark mode toggle"
              agent="frontend-agent"
              time="12m"
              status="active"
            />
            <NeonItemRow
              title="Spring palette — warm vs cool tones"
              agent="color-palette-testing"
              time="3 inv"
              status="sweep"
            />
            <NeonItemRow
              title="Daily brand audit"
              agent="scheduler"
              time="in 3h"
              status="armed"
            />
          </div>
        </div>

        {/* Ready — cool blue line */}
        <div className="relative rounded-xl border border-[#1a1a1a] bg-[#0d0d12] p-6">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-cyan-500/60 via-cyan-500/20 to-transparent" />
          <div className="flex items-center gap-3 mb-5">
            <span className="text-[14px] font-mono font-bold text-cyan-400 uppercase tracking-wider">
              READY
            </span>
            <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-[14px] font-mono tabular-nums">
              6
            </span>
          </div>
          <div className="space-y-3">
            <NeonItemRow
              title="Refactor auth middleware"
              agent="backend-refactor"
              time="45m"
              status="done"
            />
            <NeonItemRow
              title="Spring campaign hero images"
              agent="brand-asset-generator"
              time="2h"
              status="artifact"
            />
            <NeonItemRow
              title="Daily brand audit"
              agent="brand-asset-generator"
              time="6h"
              status="done"
            />
          </div>
          <button
            type="button"
            className="mt-4 text-[14px] font-mono text-[#555] hover:text-cyan-400 transition-colors"
          >
            [+3 more]
          </button>
        </div>
      </div>
    </div>
  );
}

function NeonStatCard({
  label,
  value,
  subtext,
  color,
}: {
  label: string;
  value: string;
  subtext: string;
  color: "cyan" | "emerald";
}) {
  const borderColor =
    color === "cyan" ? "border-cyan-500/20" : "border-emerald-500/20";
  const glowColor =
    color === "cyan" ? "from-cyan-500/10" : "from-emerald-500/10";
  const textColor = color === "cyan" ? "text-cyan-400" : "text-emerald-400";

  return (
    <div
      className={cn(
        "relative rounded-xl border bg-[#0d0d12] p-5 overflow-hidden",
        borderColor,
      )}
    >
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-br to-transparent pointer-events-none",
          glowColor,
        )}
      />
      <div className="relative">
        <span className="text-[14px] font-mono text-[#555] uppercase tracking-wider">
          {label}
        </span>
        <div className="flex items-baseline gap-2 mt-1">
          <span
            className={cn("text-[28px] font-black tabular-nums", textColor)}
          >
            {value}
          </span>
          <span className="text-[14px] text-[#555] font-mono">{subtext}</span>
        </div>
      </div>
    </div>
  );
}

function NeonApprovalRow({ approval }: { approval: ApprovalView }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-red-500/[0.03] border border-red-500/10 px-4 py-3">
      <Zap size={14} className="text-red-400 shrink-0" />
      <span className="flex-1 text-[14px] font-mono text-[#ccc] truncate">
        {approval.payload.kind === "ext_authz"
          ? "network_request"
          : "tool_execute"}
      </span>
      <button
        type="button"
        className="px-3 py-1 rounded bg-red-500/20 text-red-400 text-[14px] font-mono hover:bg-red-500/30 transition-colors"
      >
        ALLOW
      </button>
    </div>
  );
}

function NeonItemRow({
  title,
  agent,
  time,
  status,
}: {
  title: string;
  agent: string;
  time: string;
  status: string;
}) {
  const statusColors: Record<string, string> = {
    active: "text-emerald-400",
    sweep: "text-purple-400",
    armed: "text-amber-400",
    done: "text-cyan-400",
    artifact: "text-violet-400",
  };

  return (
    <div className="flex items-center gap-3 py-2 border-b border-[#151515] last:border-0">
      <span
        className={cn(
          "text-[14px] font-mono uppercase w-16 shrink-0",
          statusColors[status] ?? "text-[#555]",
        )}
      >
        {status}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] text-white truncate">{title}</p>
        <p className="text-[14px] font-mono text-[#555]">{agent}</p>
      </div>
      <span className="text-[14px] font-mono text-[#444] tabular-nums shrink-0">
        {time}
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   VARIATION 3: BENTO GRID
   Tight modular grid, each section is a cell. Spatial rather than linear.
   Inspired by Apple's bento marketing + Notion's dashboard views.
   ═══════════════════════════════════════════════════════════════════════════ */

function V3_BentoGrid({ approvals }: { approvals: ApprovalView[] }) {
  return (
    <div className="space-y-5 -mx-6 -mt-6 px-6 pt-6 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold text-foreground tracking-tight">
          Home
        </h1>
        <button
          type="button"
          className="text-[14px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          Since last visit <ChevronDown size={14} />
        </button>
      </div>

      {/* Bento layout */}
      <div className="grid grid-cols-4 gap-3 auto-rows-[minmax(100px,auto)]">
        {/* Blocked — spans full width */}
        {approvals.length > 0 && (
          <div className="col-span-4 rounded-2xl bg-red-500/[0.04] border border-red-500/20 p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-[15px] font-semibold text-foreground">
                Blocked ({approvals.length})
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {approvals.slice(0, 4).map((a, i) => (
                <BentoApprovalCard key={i} approval={a} />
              ))}
            </div>
          </div>
        )}

        {/* Spend — 2 cols */}
        <div className="col-span-2 rounded-2xl bg-muted/40 border border-border p-5 flex flex-col justify-between">
          <span className="text-[14px] text-muted-foreground">Spend today</span>
          <span className="text-[32px] font-bold text-foreground tabular-nums mt-2">
            $4.82
          </span>
          <div className="flex items-end gap-[3px] mt-3 h-10">
            {[
              30, 45, 20, 60, 80, 55, 40, 70, 35, 50, 65, 45, 55, 70, 40, 80,
            ].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-[2px] bg-foreground/20"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>

        {/* Compute — 2 cols */}
        <div className="col-span-2 rounded-2xl bg-muted/40 border border-border p-5 flex flex-col justify-between">
          <span className="text-[14px] text-muted-foreground">Compute</span>
          <span className="text-[32px] font-bold text-foreground tabular-nums mt-2">
            5<span className="text-[20px] text-muted-foreground">/8</span>
          </span>
          <div className="grid grid-cols-8 gap-1 mt-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-6 rounded",
                  i < 3 && "bg-emerald-500/60",
                  i >= 3 && i < 5 && "bg-amber-400/50",
                  i >= 5 && "bg-muted border border-border",
                )}
              />
            ))}
          </div>
        </div>

        {/* Running — 2 cols, tall */}
        <div className="col-span-2 row-span-2 rounded-2xl bg-muted/40 border border-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-[15px] font-semibold text-foreground">
              Running
            </h2>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="space-y-3">
            <BentoCard
              title="Implement dark mode toggle"
              subtitle="frontend-agent"
              badge="12m"
            />
            <BentoCard
              title="Spring palette sweep"
              subtitle="color-palette-testing"
              badge="3 inv"
            />
            <BentoCard
              title="Daily brand audit"
              subtitle="scheduler"
              badge="in 3h"
            />
          </div>
        </div>

        {/* Ready — 2 cols, tall */}
        <div className="col-span-2 row-span-2 rounded-2xl bg-muted/40 border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-semibold text-foreground">
              Ready for you
            </h2>
            <span className="text-[14px] text-muted-foreground tabular-nums">
              6 items
            </span>
          </div>
          <div className="space-y-3">
            <BentoCard
              title="Refactor auth middleware"
              subtitle="backend-refactor · 45m ago"
            />
            <BentoCard
              title="Spring campaign hero images"
              subtitle="brand-asset-generator · 2h ago"
              icon="artifact"
            />
            <BentoCard
              title="Daily brand audit"
              subtitle="brand-asset-generator · 6h ago"
            />
            <BentoCard
              title="Nightly performance report"
              subtitle="reporting-agent · 8h ago"
              icon="artifact"
            />
          </div>
          <button
            type="button"
            className="mt-3 text-[14px] text-accent hover:text-accent/80"
          >
            +2 more
          </button>
        </div>
      </div>
    </div>
  );
}

function BentoCard({
  title,
  subtitle,
  badge,
  icon,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  icon?: string;
}) {
  return (
    <div className="rounded-xl bg-card border border-border/50 p-3 hover:border-border transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {icon === "artifact" && (
              <Folders size={14} className="text-muted-foreground shrink-0" />
            )}
            <p className="text-[14px] font-medium text-foreground truncate">
              {title}
            </p>
          </div>
          <p className="text-[14px] text-muted-foreground truncate mt-0.5">
            {subtitle}
          </p>
        </div>
        {badge && (
          <span className="shrink-0 text-[14px] text-muted-foreground tabular-nums">
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

function BentoApprovalCard({ approval }: { approval: ApprovalView }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-card border border-red-500/10 p-3">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-foreground truncate">
          {approval.payload.kind === "ext_authz"
            ? "Network request"
            : "Tool use"}
        </p>
        <p className="text-[14px] text-muted-foreground truncate">Waiting</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 text-[14px] rounded-lg"
      >
        Allow
      </Button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   VARIATION 4: GRADIENT MESH
   Soft, organic gradients. Rounded pill shapes. Warm/cool tonal shifts.
   Inspired by Stripe's soft gradients + Raycast's warm dark UI.
   ═══════════════════════════════════════════════════════════════════════════ */

function V4_GradientMesh({ approvals }: { approvals: ApprovalView[] }) {
  return (
    <div className="relative -mx-6 -mt-6 px-8 pt-8 pb-20 min-h-screen overflow-hidden">
      {/* Background mesh */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-[400px] bg-gradient-to-b from-purple-500/[0.04] via-accent/[0.02] to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-[300px] bg-gradient-to-t from-emerald-500/[0.03] to-transparent" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto space-y-8">
        {/* Header — centered */}
        <div className="text-center space-y-2">
          <h1 className="text-[36px] font-bold text-foreground tracking-tight">
            Good evening
          </h1>
          <p className="text-[16px] text-muted-foreground">
            Here's what happened since your last visit
          </p>
        </div>

        {/* Blocked pill */}
        {approvals.length > 0 && (
          <div className="rounded-[28px] bg-gradient-to-r from-red-500/10 via-red-500/5 to-transparent border border-red-500/20 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertCircle size={16} className="text-red-400" />
              </div>
              <div>
                <h2 className="text-[16px] font-semibold text-foreground">
                  {approvals.length} things need your attention
                </h2>
                <p className="text-[14px] text-muted-foreground">
                  Agents are waiting on your decisions
                </p>
              </div>
            </div>
            <div className="space-y-2 pl-11">
              {approvals.slice(0, 3).map((a, i) => (
                <MeshApprovalRow key={i} approval={a} />
              ))}
            </div>
          </div>
        )}

        {/* Stats — horizontal pills */}
        <div className="flex gap-3">
          <div className="flex-1 rounded-full bg-gradient-to-r from-accent/10 to-transparent border border-accent/20 px-6 py-4 flex items-center justify-between">
            <span className="text-[14px] text-muted-foreground">Spend</span>
            <span className="text-[18px] font-bold text-foreground tabular-nums">
              $4.82
            </span>
          </div>
          <div className="flex-1 rounded-full bg-gradient-to-r from-emerald-500/10 to-transparent border border-emerald-500/20 px-6 py-4 flex items-center justify-between">
            <span className="text-[14px] text-muted-foreground">Compute</span>
            <span className="text-[18px] font-bold text-foreground tabular-nums">
              5/8 CPU
            </span>
          </div>
        </div>

        {/* Running */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-[16px] font-semibold text-foreground">
              Running now
            </h2>
          </div>
          <MeshCard>
            <MeshRow
              icon={<Play size={14} className="text-emerald-400" />}
              title="Implement dark mode toggle"
              subtitle="frontend-agent"
              meta="12m ago"
            />
            <MeshDivider />
            <MeshRow
              icon={<Chemistry size={16} className="text-purple-400" />}
              title="Spring palette — warm vs cool tones"
              subtitle="color-palette-testing"
              meta="3 running"
            />
            <MeshDivider />
            <MeshRow
              icon={<Time size={16} className="text-amber-400" />}
              title="Daily brand audit"
              subtitle="Every weekday · next in 3h"
              meta="armed"
            />
          </MeshCard>
        </div>

        {/* Ready */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-[16px] font-semibold text-foreground">
              Ready for you
            </h2>
            <span className="text-[14px] text-muted-foreground tabular-nums">
              6 items
            </span>
          </div>
          <MeshCard>
            <MeshRow
              icon={<Check size={14} className="text-accent" />}
              title="Refactor auth middleware"
              subtitle="backend-refactor"
              meta="45m ago"
            />
            <MeshDivider />
            <MeshRow
              icon={<Folders size={14} className="text-violet-400" />}
              title="Spring campaign hero images"
              subtitle="brand-asset-generator"
              meta="2h ago"
            />
            <MeshDivider />
            <MeshRow
              icon={<Time size={14} className="text-muted-foreground" />}
              title="Daily brand audit"
              subtitle="brand-asset-generator"
              meta="6h ago"
            />
          </MeshCard>
          <button
            type="button"
            className="w-full text-center text-[14px] text-muted-foreground hover:text-foreground py-2 transition-colors"
          >
            Show 3 more
          </button>
        </div>
      </div>
    </div>
  );
}

function MeshCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/30 p-1 shadow-sm">
      <div className="rounded-[20px] bg-card/80 backdrop-blur-sm divide-y-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function MeshDivider() {
  return <div className="mx-5 border-t border-border/40" />;
}

function MeshRow({
  icon,
  title,
  subtitle,
  meta,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  meta: string;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors">
      <span className="shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-medium text-foreground truncate">
          {title}
        </p>
        <p className="text-[14px] text-muted-foreground truncate">{subtitle}</p>
      </div>
      <span className="text-[14px] text-muted-foreground tabular-nums shrink-0">
        {meta}
      </span>
      <ChevronRight size={16} className="text-muted-foreground/40 shrink-0" />
    </div>
  );
}

function MeshApprovalRow({ approval }: { approval: ApprovalView }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-card/60 border border-border/40 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-foreground">
          {approval.payload.kind === "ext_authz"
            ? "Network request"
            : "Tool use"}
        </p>
      </div>
      <Button
        size="sm"
        className="rounded-full text-[14px] bg-foreground text-background hover:bg-foreground/90"
      >
        Allow
      </Button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   VARIATION 5: BRUTALIST
   Raw, typographic, editorial. Monospace dominance, high contrast.
   Inspired by Bloomberg Terminal + Readymag + brutalist web design.
   ═══════════════════════════════════════════════════════════════════════════ */

function V5_Brutalist({ approvals }: { approvals: ApprovalView[] }) {
  return (
    <div className="relative -mx-6 -mt-6 px-8 pt-8 pb-20 min-h-screen font-mono">
      <div className="max-w-3xl space-y-10">
        {/* Header — massive type */}
        <div className="border-b-2 border-foreground pb-4">
          <h1 className="text-[48px] font-black text-foreground leading-none tracking-tighter uppercase">
            HOME
          </h1>
          <div className="flex items-center justify-between mt-2">
            <span className="text-[14px] text-muted-foreground uppercase tracking-widest">
              Agent Operations Dashboard
            </span>
            <span className="text-[14px] text-muted-foreground">
              Since last visit ↓
            </span>
          </div>
        </div>

        {/* Blocked — screaming red bar */}
        {approvals.length > 0 && (
          <div className="space-y-3">
            <div className="bg-red-600 text-white px-4 py-2 flex items-center justify-between">
              <span className="text-[14px] font-bold uppercase tracking-wider">
                ! BLOCKED — {approvals.length} WAITING
              </span>
              <span className="text-[14px]">ACTION REQUIRED</span>
            </div>
            {approvals.slice(0, 3).map((a, i) => (
              <div
                key={i}
                className="border-l-4 border-red-600 pl-4 py-2 flex items-center justify-between"
              >
                <div>
                  <span className="text-[14px] font-bold text-foreground uppercase">
                    {a.payload.kind === "ext_authz"
                      ? "NET_REQUEST"
                      : "TOOL_EXEC"}
                  </span>
                  <span className="text-[14px] text-muted-foreground ml-3">
                    awaiting decision
                  </span>
                </div>
                <button
                  type="button"
                  className="border-2 border-foreground px-3 py-1 text-[14px] font-bold text-foreground hover:bg-foreground hover:text-background transition-colors uppercase"
                >
                  Allow
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Stats — raw numbers */}
        <div className="grid grid-cols-2 gap-8 border-y-2 border-foreground/20 py-6">
          <div>
            <span className="text-[14px] text-muted-foreground uppercase tracking-widest block">
              Spend / Today
            </span>
            <span className="text-[40px] font-black text-foreground tabular-nums leading-tight">
              $4.82
            </span>
          </div>
          <div>
            <span className="text-[14px] text-muted-foreground uppercase tracking-widest block">
              Compute / Active
            </span>
            <span className="text-[40px] font-black text-foreground tabular-nums leading-tight">
              5/8
            </span>
            <span className="text-[16px] text-muted-foreground ml-2">CPU</span>
          </div>
        </div>

        {/* Running */}
        <div className="space-y-0">
          <div className="bg-foreground text-background px-4 py-2 flex items-center justify-between">
            <span className="text-[14px] font-bold uppercase tracking-wider">
              Running Now
            </span>
            <span className="text-[14px] tabular-nums">3 active</span>
          </div>
          <BrutalistRow
            index={1}
            title="Implement dark mode toggle"
            meta="frontend-agent | 12m"
            status="●"
          />
          <BrutalistRow
            index={2}
            title="Spring palette — warm vs cool tones"
            meta="color-palette-testing | 3 invocations"
            status="●"
          />
          <BrutalistRow
            index={3}
            title="Daily brand audit"
            meta="scheduler | next: 3h"
            status="◷"
          />
        </div>

        {/* Ready */}
        <div className="space-y-0">
          <div className="bg-foreground/10 px-4 py-2 flex items-center justify-between border-2 border-foreground/20">
            <span className="text-[14px] font-bold text-foreground uppercase tracking-wider">
              Ready For You
            </span>
            <span className="text-[14px] text-muted-foreground tabular-nums">
              6 items
            </span>
          </div>
          <BrutalistRow
            index={1}
            title="Refactor auth middleware"
            meta="backend-refactor | 45m ago"
            status="✓"
          />
          <BrutalistRow
            index={2}
            title="Spring campaign hero images"
            meta="brand-asset-generator | 2h ago"
            status="◈"
          />
          <BrutalistRow
            index={3}
            title="Daily brand audit"
            meta="brand-asset-generator | 6h ago"
            status="✓"
          />
          <BrutalistRow
            index={4}
            title="Nightly performance report"
            meta="reporting-agent | 8h ago"
            status="◈"
          />
          <div className="border-l-2 border-border px-4 py-2">
            <span className="text-[14px] text-muted-foreground">
              [+2 more items]
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BrutalistRow({
  index,
  title,
  meta,
  status,
}: {
  index: number;
  title: string;
  meta: string;
  status: string;
}) {
  return (
    <div className="border-l-2 border-b border-border pl-4 pr-4 py-3 flex items-center gap-4 hover:bg-muted/30 transition-colors">
      <span className="text-[14px] text-muted-foreground tabular-nums w-6 shrink-0">
        {String(index).padStart(2, "0")}
      </span>
      <span className="text-[16px] shrink-0">{status}</span>
      <div className="flex-1 min-w-0">
        <span className="text-[15px] font-bold text-foreground truncate block">
          {title}
        </span>
        <span className="text-[14px] text-muted-foreground">{meta}</span>
      </div>
      <button
        type="button"
        className="text-[14px] text-muted-foreground hover:text-foreground border-b border-current leading-tight transition-colors"
      >
        OPEN →
      </button>
    </div>
  );
}
