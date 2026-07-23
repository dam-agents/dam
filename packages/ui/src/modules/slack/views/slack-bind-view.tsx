import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { getBrand } from "../../../brand.js";
import { ListSkeleton } from "../../../components/list-skeleton.js";
import type { AgentView } from "../../../types.js";
import { useAgents, useAgentsList } from "../../agents/api/queries.js";
import { CreateAgentInline } from "../../agents/components/create-agent-inline.js";
import { useBindSlackChannel } from "../api/mutations.js";
import {
  type BindErrorCopy,
  bindErrorCopy,
  callbackErrorCopy,
  readCallbackErrorFromSearch,
  readFlowIdFromSearch,
} from "../lib/bind-flow.js";

// URL-owned inputs, read once: a refresh keeps working within the flow TTL.
const flowId = readFlowIdFromSearch(window.location.search);
const callbackError = readCallbackErrorFromSearch(window.location.search);

export function SlackBindView() {
  const brandShort = getBrand().short;
  const agents = useAgents();
  const list = useAgentsList();
  const bind = useBindSlackChannel();
  const [error, setError] = useState<BindErrorCopy | null>(null);
  const [bound, setBound] = useState<{
    agentName: string;
    channelTitle: string | null;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<AgentView | null>(null);

  // Bridge the create→refetch gap: show a freshly created agent in the picker
  // immediately, before the invalidated list query has refetched. The server
  // list is authoritative once it includes the agent.
  const displayedAgents = useMemo(() => {
    if (!justCreated || list.some((a) => a.id === justCreated.id)) return list;
    return [...list, justCreated];
  }, [list, justCreated]);

  const handleCreated = (agent: AgentView) => {
    setJustCreated(agent);
    setCreating(false);
    setError(null);
  };

  // With no agents to pick, open the create form by default — and keep it open
  // through an out-of-band list change (another tab/CLI, the 5s poll) so
  // in-progress input is never discarded. Seeded once, after the first load.
  const seededCreate = useRef(false);
  useEffect(() => {
    if (seededCreate.current || agents.isLoading) return;
    seededCreate.current = true;
    if (list.length === 0) setCreating(true);
  }, [agents.isLoading, list.length]);

  if (callbackError) {
    return (
      <TerminalError copy={callbackErrorCopy(callbackError, brandShort)} />
    );
  }
  if (!flowId) {
    return (
      <TerminalError
        copy={{
          title: "This page is opened from Slack",
          hint: `Run \`/${brandShort} bind\` in your channel to get a fresh link.`,
          terminal: true,
        }}
      />
    );
  }
  if (bound) {
    return (
      <BindSuccess
        agentName={bound.agentName}
        channelTitle={bound.channelTitle}
        brandShort={brandShort}
      />
    );
  }
  if (error?.terminal) {
    return <TerminalError copy={error} />;
  }
  if (agents.isLoading) {
    return (
      <Page title="Connect this channel to an agent">
        <ListSkeleton rows={3} />
      </Page>
    );
  }
  const pick = (agent: AgentView) => {
    setError(null);
    bind.mutate(
      { agentId: agent.id, flowId },
      {
        onSuccess: (res) =>
          setBound({ agentName: agent.name, channelTitle: res.channelTitle }),
        onError: (e) => {
          const code = (e as { data?: { code?: string } }).data?.code;
          setError(bindErrorCopy(code, brandShort));
        },
      },
    );
  };

  const hasAgents = displayedAgents.length > 0;

  return (
    <Page title="Connect this channel to an agent">
      <p className="text-sm text-muted-foreground">
        {hasAgents
          ? "Everyone in this Slack channel will be able to use the agent you pick. Turns run under the agent's own connected accounts and API tokens, and your acceptance of the Terms of Use covers every turn."
          : "You don't own any agents yet. Create one to connect it — everyone in this Slack channel will then be able to use it, running under its own connected accounts and your acceptance of the Terms of Use."}
      </p>
      {error && (
        <p className="text-sm text-red-600">
          {error.title} — {error.hint}
        </p>
      )}
      {hasAgents && (
        <div className="flex flex-col gap-2">
          {displayedAgents.map((agent) => (
            <BindAgentRow
              key={agent.id}
              agent={agent}
              highlighted={justCreated?.id === agent.id}
              disabled={bind.isPending}
              pending={bind.isPending && bind.variables?.agentId === agent.id}
              onPick={() => pick(agent)}
            />
          ))}
        </div>
      )}
      {creating ? (
        <CreateAgentInline onCreated={handleCreated} />
      ) : hasAgents ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          + Create a new agent
        </button>
      ) : null}
    </Page>
  );
}

function BindAgentRow({
  agent,
  highlighted,
  disabled,
  pending,
  onPick,
}: {
  agent: AgentView;
  highlighted: boolean;
  disabled: boolean;
  pending: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg border bg-background px-4 py-3 text-left hover:border-foreground/40 disabled:opacity-60",
        highlighted ? "border-foreground" : "border-border",
      )}
    >
      <span className="text-[14px] font-semibold text-foreground">
        {pending ? `Connecting ${agent.name}…` : agent.name}
      </span>
      {agent.description && (
        <span className="text-[12px] text-muted-foreground">
          {agent.description}
        </span>
      )}
      {agent.templateId && (
        <span className="text-[11px] font-mono text-muted-foreground">
          {agent.templateId}
        </span>
      )}
    </button>
  );
}

function BindSuccess({
  agentName,
  channelTitle,
  brandShort,
}: {
  agentName: string;
  channelTitle: string | null;
  brandShort: string;
}) {
  return (
    <Page
      title={
        channelTitle ? `“${channelTitle}” is connected` : "Channel connected"
      }
    >
      <p className="text-sm text-muted-foreground">
        This channel is now connected to <strong>{agentName}</strong>. Return to
        Slack — the bot has posted a confirmation. Run{" "}
        <code>/{brandShort} unbind</code> there to disconnect.
      </p>
      <DashboardButton label="Go to dashboard" />
    </Page>
  );
}

function TerminalError({ copy }: { copy: BindErrorCopy }) {
  return (
    <Page title={copy.title}>
      <p className="text-sm text-muted-foreground">{copy.hint}</p>
      <DashboardButton label="Go to dashboard" />
    </Page>
  );
}

function DashboardButton({ label }: { label: string }) {
  return (
    <Button
      type="button"
      className="self-start"
      onClick={() => window.location.assign("/")}
    >
      {label}
    </Button>
  );
}

function Page({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-140 px-4 py-10 flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}
