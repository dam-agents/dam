import { Checkmark, Earth, Share } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react";

import { SlackColorIcon } from "@/components/brand-icons";
import { Button } from "@/components/ui/button";
import {
  EmptyHero,
  MockAgentMessage,
  MockCard,
  MockChip,
  MockPrompt,
} from "@/components/ui/empty-hero";

import { PageShell } from "../pages/_shell";

const meta: Meta = {
  title: "Final/Artifacts Empty State",
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

const BARS = [30, 55, 45, 80, 60, 90, 70];

export const Default: Story = {
  render: () => (
    <PageShell activeNav="artifacts" maxWidth="full">
      <EmptyHero
        title="Artifacts"
        actions={
          <>
            <Button size="lg">Create agent</Button>
            <Button size="lg" variant="outline">
              Upload artifact
            </Button>
          </>
        }
        illustration={
          <div className="flex flex-col">
            <MockPrompt className="w-[68%]">
              Pull our weekly metrics and build me a dashboard every Monday
            </MockPrompt>
            <MockChip className="top-[12%] right-[18%]">
              <Share size={14} />
            </MockChip>
            <MockCard className="z-10 -mt-2 ml-[33%] flex gap-4">
              <div className="flex w-28 shrink-0 flex-col gap-1.5 rounded-md border border-border p-2">
                <div className="flex gap-1">
                  <span className="h-2.5 flex-1 rounded-sm bg-muted" />
                  <span className="h-2.5 flex-1 rounded-sm bg-muted" />
                  <span className="h-2.5 flex-1 rounded-sm bg-success-light" />
                </div>
                <div className="flex h-10 items-end gap-1 rounded-sm border border-border px-1">
                  {BARS.map((h, i) => (
                    <span
                      key={i}
                      style={{ height: `${h}%` }}
                      className={
                        i === BARS.length - 1
                          ? "flex-1 bg-accent"
                          : "flex-1 bg-accent/40"
                      }
                    />
                  ))}
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="font-semibold">Weekly metrics dashboard</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1 rounded-full bg-success-light px-2 py-0.5 text-success">
                    <Earth size={12} />
                    Public
                  </span>
                  HTML · 38 KB
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="truncate rounded-sm border border-border px-2 py-1 font-mono text-xs">
                    share.example.com/a/pw4SYBykUQQ
                  </span>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border text-success">
                    <Checkmark size={14} />
                  </span>
                </div>
              </div>
            </MockCard>
            <MockChip className="top-[44%] left-[4%]">
              <SlackColorIcon className="size-4" />
            </MockChip>
            <MockAgentMessage time="6:00 AM" className="mt-4 ml-[12%] w-[68%]">
              Weekly dashboard is ready. Signups up 12% this week.
              <div className="truncate text-accent">
                share.example.com/a/pw4SYBykUQQ…
              </div>
            </MockAgentMessage>
          </div>
        }
      >
        Pages and files your agents create land here. Preview them, share them
        with a public link, or have an agent post them to Slack when they're
        ready.
      </EmptyHero>
    </PageShell>
  ),
};
