import { Idea, Play, Renew, Security, Time } from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LayoutOption = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";

const OPTIONS: { id: LayoutOption; label: string; description: string }[] = [
  {
    id: "A",
    label: "1. Minimal Spinner + Tip Card",
    description:
      "Clean spinner with sandbox name, a single rotating tip in a bordered card below. No redundant status badge.",
  },
  {
    id: "B",
    label: "2. Progress Dots + Tip",
    description:
      "Animated dot sequence showing startup progress. Tip appears inline below the name with no card wrapper.",
  },
  {
    id: "C",
    label: "3. Full-bleed Gradient Tip",
    description:
      "The tip takes center stage in a large gradient card. Spinner and name are compact above.",
  },
  {
    id: "D",
    label: "4. Sidebar Tips Carousel",
    description:
      "Spinner + name left-aligned, tips rotate in a right-aligned panel. Uses horizontal space.",
  },
  {
    id: "E",
    label: "5. Pill Status + Inline Tip",
    description:
      "A single pill shows 'Starting...' with a pulsing dot. Tip text rotates below the name with a subtle fade transition.",
  },
  {
    id: "F",
    label: "6. Icon-led Tip Stack",
    description:
      "Each tip has its own icon. They stack vertically and fade in one by one as the agent starts.",
  },
  {
    id: "G",
    label: "7. Needs Start (CTA)",
    description:
      "The sandbox is stopped. Shows name + status + a prominent Start button. No tips — they only appear once starting.",
  },
  {
    id: "H",
    label: "8. Compact Header Bar",
    description:
      "A fixed bar at the top of the chat area with spinner, name, and rotating tip. Chat area is blurred below.",
  },
  {
    id: "I",
    label: "9. Center Card with Shimmer",
    description:
      "A centered card with shimmer animation on the border. Tip inside with a typewriter reveal effect.",
  },
  {
    id: "J",
    label: "10. Ambient Background",
    description:
      "Subtle animated gradient background fills the chat area. Name and tip float centered with no card.",
  },
];

const TIPS = [
  {
    icon: Security,
    text: "Approvals are enforced outside the sandbox, so a compromised agent cannot approve itself.",
  },
  {
    icon: Idea,
    text: "You can attach connections to inject API keys without baking secrets into the image.",
  },
  {
    icon: Time,
    text: "Scheduled runs wake the sandbox automatically — no need to keep it running between jobs.",
  },
  {
    icon: Renew,
    text: "Template updates roll out new images without losing your sandbox's persistent state.",
  },
  {
    icon: Security,
    text: "Network egress is deny-by-default. Connections allowlist only the hosts your agent needs.",
  },
];

export function StartupStatesShowcase() {
  const [active, setActive] = useState<LayoutOption>("A");

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-[24px] font-semibold text-foreground">
          Startup State Options
        </h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          What the user sees while a sandbox is starting up (with rotating tips)
          and when it needs to be started. 10 layout options.
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

      {/* Preview */}
      <div className="mx-auto max-w-[800px] overflow-hidden rounded-xl border border-border bg-background shadow-sm">
        <div className="h-[520px] flex items-center justify-center relative">
          {active === "A" && <OptionA />}
          {active === "B" && <OptionB />}
          {active === "C" && <OptionC />}
          {active === "D" && <OptionD />}
          {active === "E" && <OptionE />}
          {active === "F" && <OptionF />}
          {active === "G" && <OptionG />}
          {active === "H" && <OptionH />}
          {active === "I" && <OptionI />}
          {active === "J" && <OptionJ />}
        </div>
      </div>
    </div>
  );
}

/* ─── Rotating tip hook ─── */

function useRotatingTip() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setIdx((i) => (i + 1) % TIPS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);
  return TIPS[idx]!;
}

/* ─── Spinner component ─── */

function Spinner({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className="animate-spin text-foreground/20"
    >
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        d="M20 4 A16 16 0 0 1 36 20"
        fill="none"
        stroke="var(--c-accent, #1D6BE1)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ─── Option A: Minimal Spinner + Tip Card ─── */

function OptionA() {
  const tip = useRotatingTip();
  const Icon = tip.icon;
  return (
    <div className="flex flex-col items-center gap-6 px-8 text-center">
      <Spinner size={48} />
      <div>
        <h2 className="text-[18px] font-semibold text-foreground">
          docs-reviewer
        </h2>
        <p className="mt-1 text-[14px] text-muted-foreground">Starting up...</p>
      </div>
      <div className="w-full max-w-[420px] rounded-xl border border-border bg-card p-5 text-left transition-all">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
            <Icon size={16} className="text-accent" />
          </div>
          <p className="text-[14px] leading-relaxed text-muted-foreground">
            {tip.text}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Option B: Progress Dots + Tip ─── */

function OptionB() {
  const tip = useRotatingTip();
  return (
    <div className="flex flex-col items-center gap-5 px-8 text-center">
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-2.5 rounded-full bg-accent animate-pulse"
            style={{ animationDelay: `${i * 200}ms` }}
          />
        ))}
      </div>
      <div>
        <h2 className="text-[18px] font-semibold text-foreground">
          docs-reviewer
        </h2>
        <p className="mt-2 text-[14px] text-muted-foreground italic">
          {tip.text}
        </p>
      </div>
    </div>
  );
}

/* ─── Option C: Full-bleed Gradient Tip ─── */

function OptionC() {
  const tip = useRotatingTip();
  const Icon = tip.icon;
  return (
    <div className="flex flex-col items-center gap-6 px-8 text-center">
      <div className="flex items-center gap-3">
        <Spinner size={28} />
        <h2 className="text-[16px] font-semibold text-foreground">
          docs-reviewer
        </h2>
      </div>
      <div className="w-full max-w-[480px] rounded-2xl bg-gradient-to-br from-accent/5 via-muted/60 to-card border border-border p-8 text-left">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
            <Icon size={20} className="text-accent" />
          </div>
          <div>
            <p className="text-[12px] font-medium uppercase tracking-wider text-accent mb-2">
              Did you know?
            </p>
            <p className="text-[15px] leading-relaxed text-foreground">
              {tip.text}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Option D: Sidebar Tips Carousel ─── */

function OptionD() {
  const tip = useRotatingTip();
  const Icon = tip.icon;
  return (
    <div className="flex w-full h-full">
      {/* Left: status */}
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <Spinner size={56} />
        <h2 className="text-[18px] font-semibold text-foreground">
          docs-reviewer
        </h2>
        <p className="text-[14px] text-muted-foreground">
          Pulling image & starting pod...
        </p>
      </div>
      {/* Right: tips */}
      <div className="w-[280px] border-l border-border bg-muted/20 flex flex-col items-start justify-center px-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Tips
        </p>
        <div className="flex items-start gap-3">
          <Icon size={16} className="shrink-0 text-accent mt-0.5" />
          <p className="text-[14px] leading-relaxed text-foreground/80">
            {tip.text}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Option E: Pill Status + Inline Tip ─── */

function OptionE() {
  const tip = useRotatingTip();
  return (
    <div className="flex flex-col items-center gap-5 px-8 text-center">
      <h2 className="text-[20px] font-semibold text-foreground">
        docs-reviewer
      </h2>
      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-[14px] text-muted-foreground">
        <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
        Starting...
      </span>
      <p className="mt-2 max-w-[400px] text-[14px] leading-relaxed text-muted-foreground transition-opacity">
        {tip.text}
      </p>
    </div>
  );
}

/* ─── Option F: Icon-led Tip Stack ─── */

function OptionF() {
  const [visibleCount, setVisibleCount] = useState(1);
  useEffect(() => {
    if (visibleCount >= TIPS.length) return;
    const timer = setTimeout(() => setVisibleCount((c) => c + 1), 2500);
    return () => clearTimeout(timer);
  }, [visibleCount]);

  return (
    <div className="flex flex-col items-center gap-6 px-8">
      <div className="flex items-center gap-3">
        <Spinner size={28} />
        <h2 className="text-[16px] font-semibold text-foreground">
          docs-reviewer starting...
        </h2>
      </div>
      <div className="w-full max-w-[440px] space-y-3">
        {TIPS.slice(0, visibleCount).map((t, i) => {
          const Icon = t.icon;
          return (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left anim-in"
            >
              <Icon size={16} className="shrink-0 text-accent mt-0.5" />
              <p className="text-[14px] leading-relaxed text-muted-foreground">
                {t.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Option G: Needs Start (CTA) ─── */

function OptionG() {
  return (
    <div className="flex flex-col items-center gap-5 px-8 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
        <Play size={28} className="text-foreground/60" />
      </div>
      <div>
        <h2 className="text-[20px] font-semibold text-foreground">
          docs-reviewer
        </h2>
        <p className="mt-1.5 text-[14px] text-muted-foreground">
          This sandbox is stopped.
        </p>
      </div>
      <Button size="lg" className="mt-2">
        <Play size={16} className="mr-1.5" />
        Start sandbox
      </Button>
    </div>
  );
}

/* ─── Option H: Compact Header Bar ─── */

function OptionH() {
  const tip = useRotatingTip();
  return (
    <div className="flex flex-col w-full h-full">
      {/* Header bar */}
      <div className="flex items-center gap-4 border-b border-border bg-card px-6 py-3">
        <Spinner size={20} />
        <span className="text-[14px] font-semibold text-foreground">
          docs-reviewer
        </span>
        <span className="text-[13px] text-muted-foreground">—</span>
        <span className="text-[13px] text-muted-foreground truncate flex-1">
          {tip.text}
        </span>
      </div>
      {/* Blurred chat placeholder */}
      <div className="flex-1 flex items-center justify-center bg-muted/10">
        <div className="space-y-4 opacity-20 blur-sm pointer-events-none select-none px-12">
          <div className="h-4 w-[300px] rounded bg-muted" />
          <div className="h-4 w-[250px] rounded bg-muted" />
          <div className="h-4 w-[350px] rounded bg-muted" />
          <div className="h-4 w-[200px] rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

/* ─── Option I: Center Card with Shimmer ─── */

function OptionI() {
  const tip = useRotatingTip();
  const Icon = tip.icon;
  return (
    <div className="flex flex-col items-center gap-6 px-8 text-center">
      <div className="relative w-full max-w-[440px] rounded-2xl border border-border bg-card p-8 overflow-hidden">
        {/* Shimmer border effect */}
        <div className="absolute inset-0 rounded-2xl pointer-events-none">
          <div
            className="absolute inset-0 rounded-2xl"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(29,107,225,0.08), transparent)",
              animation: "shimmer 2s infinite",
            }}
          />
        </div>
        <div className="relative flex flex-col items-center gap-5">
          <Spinner size={36} />
          <h2 className="text-[18px] font-semibold text-foreground">
            docs-reviewer
          </h2>
          <div className="flex items-start gap-3 text-left w-full rounded-lg bg-muted/30 p-4">
            <Icon size={16} className="shrink-0 text-accent mt-0.5" />
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              {tip.text}
            </p>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}

/* ─── Option J: Ambient Background ─── */

function OptionJ() {
  const tip = useRotatingTip();
  return (
    <div className="relative flex flex-col items-center justify-center w-full h-full text-center px-8 overflow-hidden">
      {/* Ambient gradient */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 30% 50%, rgba(29,107,225,0.12) 0%, transparent 60%), radial-gradient(ellipse at 70% 50%, rgba(16,185,129,0.08) 0%, transparent 50%)",
        }}
      />
      <div className="relative flex flex-col items-center gap-5">
        <Spinner size={44} />
        <h2 className="text-[20px] font-semibold text-foreground">
          docs-reviewer
        </h2>
        <p className="max-w-[380px] text-[14px] leading-relaxed text-muted-foreground">
          {tip.text}
        </p>
      </div>
    </div>
  );
}
