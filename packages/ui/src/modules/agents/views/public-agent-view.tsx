import type { Brand, PublicAgentView as PublicAgent } from "api-server-api";

import { Button } from "@/components/ui/button";

import { ownerInitials } from "../lib/owner-initials.js";

export type PublicAgentPageState =
  | { status: "loading" }
  | { status: "ready"; agent: PublicAgent | null };

export interface PublicAgentViewProps {
  state: PublicAgentPageState;
  brand: Brand;
  openPath: string;
}

function Masthead({ brand }: { brand: Brand }) {
  return (
    <div className="flex items-center gap-2 px-6 py-4 text-sm font-semibold text-foreground">
      <img src="/api/brand/icon.svg" alt="" className="size-6" />
      <span>{brand.name}</span>
    </div>
  );
}

function OwnerByline({ name }: { name: string }) {
  return (
    <div className="mt-2.5 flex items-center gap-2.5 text-sm text-muted-foreground">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
      >
        {ownerInitials(name)}
      </span>
      <span>
        Created by{" "}
        <span className="font-semibold break-words text-foreground">
          {name}
        </span>
      </span>
    </div>
  );
}

function SlackMessage({
  from,
  avatar,
  tag,
  children,
}: {
  from: string;
  avatar: string;
  tag?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 px-4 py-3.5 not-first:border-t not-first:border-border-hairline">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold tracking-tight text-muted-foreground"
      >
        {avatar}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          {from}
          {tag ? (
            <span className="ml-1.5 rounded-[3px] bg-muted px-1 py-px align-super text-[10px] font-semibold tracking-wide text-muted-foreground">
              {tag}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-sm">{children}</div>
      </div>
    </div>
  );
}

function SlackHint({ brand }: { brand: Brand }) {
  const botMention = `@${brand.short}`;
  return (
    <>
      <p className="mt-5 text-sm text-muted-foreground">
        This agent is designed for users to interact with it in Slack. Add{" "}
        {botMention} to a Slack message, and the agent will respond.
      </p>
      <div className="mt-4 overflow-hidden rounded-lg border border-border-ui bg-card">
        <div className="border-b border-border-hairline px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground">
          In Slack
        </div>
        <SlackMessage from="You" avatar="You">
          <span className="rounded-[4px] bg-accent-light px-1 font-medium text-accent">
            {botMention}
          </span>{" "}
          what changed in the latest release?
        </SlackMessage>
        <SlackMessage
          from={brand.name}
          avatar={brand.short.toUpperCase()}
          tag="AGENT"
        >
          Dark mode was added which lets you switch themes anytime from
          Settings. Your selection is also now remembered between sessions.
        </SlackMessage>
      </div>
    </>
  );
}

function pitch(brand: Brand, subject: "this-agent" | "platform"): string {
  const lead =
    subject === "this-agent"
      ? `This agent was created with ${brand.name}, a platform`
      : `${brand.name} is a platform`;
  const entitlement = brand.vendor
    ? ` Everyone at ${brand.vendor} already has access.`
    : "";
  return (
    `${lead} for running agents securely in the cloud, running experiments, ` +
    `and creating knowledge bases.${entitlement}`
  );
}

function CallsToAction({
  brand,
  openPath,
}: {
  brand: Brand;
  openPath: string;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <Button asChild>
        <a href="/">Create your own agent</a>
      </Button>
      <span className="ml-1 text-sm">
        Already have an account?{" "}
        <a href={openPath} className="font-medium text-accent hover:underline">
          Open in {brand.name}
        </a>
      </span>
    </div>
  );
}

function NamedAgent({
  agent,
  brand,
  openPath,
}: {
  agent: PublicAgent;
  brand: Brand;
  openPath: string;
}) {
  return (
    <>
      <div className="flex-1 px-6 pt-24">
        <div className="mx-auto w-full max-w-[640px]">
          <h1 className="text-2xl leading-tight font-semibold text-balance break-words">
            {agent.name}
          </h1>
          {agent.ownerName === null ? null : (
            <OwnerByline name={agent.ownerName} />
          )}
          <SlackHint brand={brand} />
        </div>
      </div>
      <div className="mt-14 border-t border-border-ui bg-secondary px-6 pt-10 pb-12">
        <div className="mx-auto w-full max-w-[640px]">
          <h2 className="text-lg leading-snug font-semibold text-balance">
            Create your own agents with {brand.name}.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            {pitch(brand, "this-agent")}
          </p>
          <CallsToAction brand={brand} openPath={openPath} />
        </div>
      </div>
    </>
  );
}

function GenericPitch({ brand, openPath }: { brand: Brand; openPath: string }) {
  return (
    <div className="flex-1 px-6 pt-24">
      <div className="mx-auto w-full max-w-[640px]">
        <h1 className="text-2xl leading-tight font-semibold text-balance">
          Create your own agents with {brand.name}.
        </h1>
        <p className="mt-5 text-sm text-muted-foreground">
          {pitch(brand, "platform")}
        </p>
        <CallsToAction brand={brand} openPath={openPath} />
      </div>
    </div>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The whole page a visitor with no login sees. It
 * renders from a state rather than from an agent, because the masthead has to
 * paint before the public read resolves: the reader arrives from a Slack link
 * on an empty document, and waiting for the fetch would show them a white page.
 * The loading state carries no pitch, so a named agent never flashes the
 * generic copy first.
 */
export function PublicAgentView({
  state,
  brand,
  openPath,
}: PublicAgentViewProps) {
  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <Masthead brand={brand} />
      {state.status === "loading" ? null : state.agent ? (
        <NamedAgent agent={state.agent} brand={brand} openPath={openPath} />
      ) : (
        <GenericPitch brand={brand} openPath={openPath} />
      )}
    </main>
  );
}
