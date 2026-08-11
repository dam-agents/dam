import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type StyleOption =
  | "current"
  | "muted-bg"
  | "underline"
  | "pill"
  | "left-bar"
  | "weight-only"
  | "color-accent"
  | "subtle-border"
  | "highlight"
  | "minimal";

const OPTIONS: { id: StyleOption; label: string; description: string }[] = [
  {
    id: "current",
    label: "1. Current",
    description:
      "Standard monospace code with a dark/gray background chip. Bold is heavier weight. Links are accent-colored.",
  },
  {
    id: "muted-bg",
    label: "2. Muted Banner BG",
    description:
      "Inline code uses the bg-muted/40 style from the update notification banner. Softer, blends more with surrounding text.",
  },
  {
    id: "pill",
    label: "3. Rounded Pill",
    description:
      "Code spans become fully rounded pills with a subtle border. More distinct separation but rounder and friendlier.",
  },
  {
    id: "underline",
    label: "4. Underline Accent",
    description:
      "No background — code is differentiated by a colored underline and monospace font. Less visual noise.",
  },
  {
    id: "left-bar",
    label: "5. Left Border",
    description:
      "A thin left border on code spans (like a mini blockquote). Adds structure without background clutter.",
  },
  {
    id: "weight-only",
    label: "6. Weight + Mono Only",
    description:
      "No background or borders. Code is just monospace with slightly heavier weight. Maximum readability, minimum chrome.",
  },
  {
    id: "color-accent",
    label: "7. Accent Color Text",
    description:
      "Code text is tinted with the accent color. No background. Stands out through color alone.",
  },
  {
    id: "subtle-border",
    label: "8. Hairline Border",
    description:
      "A 1px border around code spans with no fill. Clean and minimal but still clearly delineated.",
  },
  {
    id: "highlight",
    label: "9. Warm Highlight",
    description:
      "A warm yellowish highlight behind code (like a highlighter pen). Eye-catching but could be noisy with many spans.",
  },
  {
    id: "minimal",
    label: "10. Reduced Opacity",
    description:
      "Code is rendered at reduced opacity with monospace. Deliberately recedes so prose dominates.",
  },
];

export function InlineFormattingShowcase() {
  const [active, setActive] = useState<StyleOption>("current");

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-[24px] font-semibold text-foreground">
          Inline Formatting Options
        </h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          A heavily formatted agent response shown with 10 different inline code
          styling approaches. Toggle between them to compare readability.
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

      {/* Chat preview */}
      <div className="mx-auto max-w-[720px] rounded-xl border border-border bg-background p-6 shadow-sm">
        <FakeChatMessage style={active} />
      </div>
    </div>
  );
}

/* ─── Styled inline code component ─── */

function Code({ children, style }: { children: string; style: StyleOption }) {
  const base = "font-mono text-[13px]";

  const classMap: Record<StyleOption, string> = {
    current:
      "rounded-md bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[13px] font-mono text-foreground",
    "muted-bg":
      "rounded-md bg-muted/40 border border-border px-1.5 py-0.5 text-[13px] font-mono text-foreground",
    pill: "rounded-full bg-muted/50 border border-border/60 px-2 py-0.5 text-[13px] font-mono text-foreground",
    underline:
      "border-b-2 border-accent/40 pb-[1px] text-[13px] font-mono text-foreground",
    "left-bar":
      "border-l-2 border-accent/50 pl-1.5 text-[13px] font-mono text-foreground",
    "weight-only": "text-[13px] font-mono font-semibold text-foreground",
    "color-accent": "text-[13px] font-mono text-accent",
    "subtle-border":
      "rounded-md border border-border px-1.5 py-0.5 text-[13px] font-mono text-foreground",
    highlight:
      "rounded-sm bg-yellow-100 dark:bg-yellow-900/30 px-1 py-0.5 text-[13px] font-mono text-foreground",
    minimal: "text-[13px] font-mono text-foreground/60",
  };

  return <code className={cn(base, classMap[style])}>{children}</code>;
}

/* ─── Bold component ─── */

function Bold({ children, style }: { children: string; style: StyleOption }) {
  const classMap: Record<StyleOption, string> = {
    current: "font-semibold text-foreground",
    "muted-bg": "font-semibold text-foreground",
    pill: "font-semibold text-foreground",
    underline: "font-semibold text-foreground",
    "left-bar": "font-semibold text-foreground",
    "weight-only": "font-bold text-foreground",
    "color-accent": "font-semibold text-foreground",
    "subtle-border": "font-semibold text-foreground",
    highlight: "font-semibold text-foreground",
    minimal: "font-semibold text-foreground",
  };

  return <strong className={classMap[style]}>{children}</strong>;
}

/* ─── The fake chat message ─── */

function FakeChatMessage({ style }: { style: StyleOption }) {
  return (
    <div className="space-y-4">
      {/* User message */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-[14px] text-primary-foreground">
          How do I set up the agent runtime with a custom model and connect it
          to my existing sandbox?
        </div>
      </div>

      {/* Agent response */}
      <div className="space-y-4 text-[14px] leading-relaxed text-foreground/90">
        <p>
          To configure a custom model in your agent runtime, you'll need to
          modify the <Code style={style}>harnessConfig.current</Code> object via
          the <Code style={style}>useApplyHarnessConfig</Code> mutation hook.
          Here's the full setup:
        </p>

        <p>
          <Bold style={style}>Step 1: Update the model configuration.</Bold>{" "}
          Open your sandbox's configure panel and locate the{" "}
          <Code style={style}>model</Code> field under{" "}
          <Bold style={style}>Runtime Settings</Bold>. The available models are
          fetched from{" "}
          <Code style={style}>harnessConfig.status.catalog.options</Code> — each
          option includes a <Code style={style}>value</Code> (the model ID like{" "}
          <Code style={style}>claude-sonnet-4-20250514</Code>) and a{" "}
          <Code style={style}>name</Code> (the display label).
        </p>

        <p>
          <Bold style={style}>Step 2: Verify the connection.</Bold> Your sandbox
          needs the <Code style={style}>conn-anthropic</Code> connection
          attached. Check that{" "}
          <Code style={style}>connections.getAgentConnections</Code> returns an
          entry with <Code style={style}>templateId: "anthropic-api"</Code>. If
          it's missing, add it through the{" "}
          <Bold style={style}>Connections step</Bold> in the wizard or via the{" "}
          <Code style={style}>connections.attach</Code> mutation.
        </p>

        <p>
          <Bold style={style}>Step 3: Apply and restart.</Bold> After calling{" "}
          <Code style={style}>harnessConfig.set</Code> with your new model
          value, the runtime needs a reconciliation cycle. Poll{" "}
          <Code style={style}>harnessConfig.settled</Code> until it returns{" "}
          <Code style={style}>{"{ settled: true }"}</Code>. If the sandbox is in{" "}
          <Code style={style}>running</Code> state, the change applies
          immediately — no restart needed. If it's{" "}
          <Code style={style}>paused</Code> or{" "}
          <Code style={style}>stopped</Code>, you'll need to call{" "}
          <Code style={style}>agents.wake</Code> or{" "}
          <Code style={style}>agents.restart</Code> first.
        </p>

        <p>
          <Bold style={style}>Important caveats:</Bold>
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            The <Code style={style}>configOptions</Code> record supports
            arbitrary key-value pairs — use <Code style={style}>maxTokens</Code>
            , <Code style={style}>temperature</Code>, or{" "}
            <Code style={style}>systemPrompt</Code> to fine-tune behavior.
          </li>
          <li>
            If <Code style={style}>availableModels</Code> is{" "}
            <Code style={style}>null</Code>, the harness hasn't reported its
            live model discovery yet. Wait for the{" "}
            <Code style={style}>hello</Code> handshake to complete.
          </li>
          <li>
            Budget limits apply per-model. Check{" "}
            <Code style={style}>budgets.reserved</Code> to see your remaining
            allocation before switching to a more expensive model like{" "}
            <Code style={style}>claude-opus-4-20250514</Code>.
          </li>
          <li>
            The <Code style={style}>mode</Code> field controls agentic behavior:
            set it to <Code style={style}>"autonomous"</Code> for hands-off
            execution or <Code style={style}>"interactive"</Code> for
            approval-gated tool use.
          </li>
        </ul>

        <p>
          You can verify everything is working by checking the{" "}
          <Code style={style}>useHarnessConfigCurrent</Code> hook's return value
          — it should reflect your changes within a few seconds. The{" "}
          <Bold style={style}>model name</Bold> will also update below the chat
          input automatically.
        </p>
      </div>
    </div>
  );
}
