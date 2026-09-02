import { Bot, User } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/ui/page-header";

import { INGREDIENT_ICON, INGREDIENT_LABEL, type Pack } from "../data/packs.js";

/**
 * A demo runs on a throwaway agent whose slots are filled with sample content,
 * so the pack works end to end with nothing connected. "Make this mine" keeps
 * the agent and turns those sample slots into the fill-these-in list.
 *
 * The exchanges are fixtures. Nothing here provisions an agent or starts a run.
 */
const DEMO_CHAT: Record<string, { from: "user" | "agent"; text: string }[]> = {
  "design-prototyper": [
    { from: "user", text: "Prototype the empty state in issue 12." },
    {
      from: "agent",
      text: "Built it from the sample design system and pushed to sample-design-repo. Prototype link is in the artifacts tab.",
    },
  ],
  "code-reviewer": [
    { from: "user", text: "Anything worth looking at this morning?" },
    {
      from: "agent",
      text: "Three open pull requests on sample-service. One drops an error without handling it — details in #sample-reviews.",
    },
  ],
  "codebase-qa": [
    { from: "user", text: "Where does the retry logic live?" },
    {
      from: "agent",
      text: "In sample-monorepo, packages/core/src/retry.ts. Callers pass a backoff; the default is in config.ts.",
    },
  ],
  "link-monitor": [
    { from: "user", text: "What broke overnight?" },
    {
      from: "agent",
      text: "Two links out of 148. Both on the sample docs site, both 404. Report is in the artifacts tab.",
    },
  ],
  "paper-scanner": [
    { from: "user", text: "Anything new this week?" },
    {
      from: "agent",
      text: "Four papers relevant to sample-research-repo. The closest one replaces the sampler you're using.",
    },
  ],
  "optimization-campaign": [
    { from: "user", text: "How is the campaign going?" },
    {
      from: "agent",
      text: "Six runs on sample-kernels. Best is 1.4× the baseline. What each run tried is in the artifacts tab.",
    },
  ],
};

interface Props {
  pack: Pack;
  onMakeMine: (pack: Pack) => void;
  onBack: () => void;
}

export function PackDemoView({ pack, onMakeMine, onBack }: Props) {
  const chat = DEMO_CHAT[pack.id] ?? [];

  return (
    <div data-testid="pack-demo">
      <PageHeader
        title={pack.name}
        adornment={<Badge variant="warning">Demo</Badge>}
        description="Runs on sample content, so nothing is connected to your work."
        actions={
          <>
            <Button variant="outline" onClick={onBack}>
              Back to packs
            </Button>
            <Button onClick={() => onMakeMine(pack)}>Make this mine</Button>
          </>
        }
      />

      <Callout tone="warning" size="sm" className="mb-6">
        <p className="text-sm text-muted-foreground">
          Everything this agent knows is sample content.
        </p>
      </Callout>

      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
          {chat.map((turn, i) => (
            <div key={i} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                {turn.from === "user" ? (
                  <User className="size-4 text-muted-foreground" />
                ) : (
                  <Bot className="size-4 text-muted-foreground" />
                )}
              </span>
              <p className="pt-1.5 text-sm leading-relaxed text-foreground">
                {turn.text}
              </p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Running on
          </h3>
          <div className="mt-3 flex flex-col gap-3">
            {pack.slots.map((slot) => {
              const Icon = INGREDIENT_ICON[slot.kind];
              return (
                <div key={slot.label} className="flex items-start gap-2.5">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{slot.demoValue}</p>
                    <p className="text-xs text-muted-foreground">
                      Sample {INGREDIENT_LABEL[slot.kind].one}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
