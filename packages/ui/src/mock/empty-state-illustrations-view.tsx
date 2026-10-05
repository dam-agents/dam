import type { ReactNode } from "react";

import { getBrand } from "@/brand";
import { Button } from "@/components/ui/button";

import { ApiKeysEmptyIllustration } from "../modules/api-keys/components/api-keys-empty-illustration.js";
import { ArtifactsEmptyIllustration } from "../modules/artifacts/components/artifacts-empty-illustration.js";
import { ConnectionsEmptyIllustration } from "../modules/connections/components/connections-empty-illustration.js";
import { ChannelsEmptyIllustration } from "../modules/sandboxes/components/channels/channels-empty-illustration.js";
import { SkillsEmptyIllustration } from "../modules/sandboxes/components/skills/skills-empty-illustration.js";
import { SchedulesEmptyIllustration } from "../modules/schedules/components/schedules-empty-illustration.js";

interface Entry {
  id: string;
  status: "Shipped" | "Proposed";
  where: string;
  current?: string;
  title: string;
  body: string;
  primary: string;
  secondary?: string;
  illustration: ReactNode;
}

function entries(): Entry[] {
  const brand = getBrand();
  const scaled = "origin-top-left scale-[1.05]";
  return [
    {
      id: "home",
      status: "Shipped",
      where: "Home — no agents yet",
      title: `Welcome to ${brand.name}`,
      body: `With ${brand.name}, you can deploy automated assistants that handle tasks like reviewing PRs, summarizing tickets, and monitoring builds in the cloud 24/7.`,
      primary: "Start from a Kit",
      secondary: "Create Agent",
      illustration: (
        <img
          src="/illustrations/home-empty-state.svg"
          alt=""
          className="h-[420px] w-[630px]"
        />
      ),
    },
    {
      id: "artifacts",
      status: "Shipped",
      where: "Artifacts page",
      title: "Artifacts",
      body: "Pages and files your agents create land here. Preview them, share them with a public link, or have an agent post them to Slack when they’re ready.",
      primary: "Create Agent",
      secondary: "Upload artifact",
      illustration: <ArtifactsEmptyIllustration className={scaled} />,
    },
    {
      id: "schedules",
      status: "Proposed",
      where: "Schedules page (/schedules)",
      current:
        "No schedules yet — A schedule wakes an agent on a cadence you set… [Go to home]",
      title: "Schedules",
      body: "A schedule wakes an agent on a cadence you set — every night, every weekday morning — and it does the work without anyone there.",
      primary: "Create Agent",
      illustration: <SchedulesEmptyIllustration className={scaled} />,
    },
    {
      id: "connections",
      status: "Proposed",
      where: "Settings → Connections, and an agent’s Connections section",
      current:
        "No connections set up yet. / You have not added any Connections to this Agent yet [Add Connection]",
      title: "Connections",
      body: "Connect the tools your agents work in — GitHub, Google Drive and more — then choose which agents can use each one.",
      primary: "Add connection",
      illustration: <ConnectionsEmptyIllustration className={scaled} />,
    },
    {
      id: "skills",
      status: "Proposed",
      where: "An agent’s Skills section",
      current:
        "No skill sources connected. Add a GitHub repo to browse and install its skills",
      title: "Skills",
      body: "Skills are instructions an agent loads for a specific job. Install them from a GitHub repo, or ask the agent to write one.",
      primary: "Add skill source",
      secondary: "Add skill sets",
      illustration: <SkillsEmptyIllustration className={scaled} />,
    },
    {
      id: "channels",
      status: "Proposed",
      where: "An agent’s Channels section (Slack)",
      current:
        "No channels connected yet. Mentions of the bot in a connected channel drive this agent. [Connect channel]",
      title: "Channels",
      body: `Connect a Slack channel and mention @${brand.name} to put this agent to work. It answers right in the thread.`,
      primary: "Connect channel",
      illustration: <ChannelsEmptyIllustration className={scaled} />,
    },
    {
      id: "api-keys",
      status: "Proposed",
      where: "Settings → API keys",
      current:
        "No API keys yet — Create one to authenticate the CLI without a browser. [Create key]",
      title: "API keys",
      body: "Create a key to sign in to the CLI without a browser, then run agents from your terminal or scripts.",
      primary: "Create key",
      illustration: <ApiKeysEmptyIllustration className={scaled} />,
    },
  ];
}

export function EmptyStateIllustrationsView({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-background">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-8 py-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Empty state illustrations
          </h1>
          <p className="text-sm text-muted-foreground">
            Shipped references first, then proposals for review.
          </p>
        </div>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="mx-auto flex max-w-[1200px] flex-col gap-16 px-8 py-10">
        {entries().map((e) => (
          <section key={e.id} id={e.id} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-3">
              <span
                className={
                  e.status === "Shipped"
                    ? "text-sm font-semibold text-success"
                    : "text-sm font-semibold text-info"
                }
              >
                {e.status}
              </span>
              <h2 className="text-base font-semibold text-foreground">
                {e.where}
              </h2>
              {e.current && (
                <p className="w-full text-sm text-muted-foreground">
                  Today: &ldquo;{e.current}&rdquo;
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse items-center gap-8 md:flex-row md:gap-12">
              <div className="flex min-w-0 flex-1 flex-col gap-5">
                <h3 className="text-2xl font-semibold tracking-tight text-foreground">
                  {e.title}
                </h3>
                <p className="max-w-[480px] text-[15px] leading-relaxed text-muted-foreground">
                  {e.body}
                </p>
                <div className="flex items-center gap-3 pt-1">
                  {e.secondary && (
                    <Button variant="outline">{e.secondary}</Button>
                  )}
                  <Button>{e.primary}</Button>
                </div>
              </div>
              <div className="h-[420px] w-[630px] shrink-0">
                {e.illustration}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
