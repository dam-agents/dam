import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import type { AgentView } from "../../../types.js";
import { useAgents, useAgentsList } from "../../agents/api/queries.js";
import { CreateAgentInline } from "../../agents/components/create-agent-inline.js";
import { useBindTelegramChat } from "../api/mutations.js";
import { useTelegramBot } from "../api/queries.js";
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

export function TelegramBindView() {
  const agents = useAgents();
  const list = useAgentsList();
  const bind = useBindTelegramChat();
  const [error, setError] = useState<BindErrorCopy | null>(null);
  const [bound, setBound] = useState<{
    agentName: string;
    chatTitle: string | null;
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
    return <TerminalError copy={callbackErrorCopy(callbackError)} />;
  }
  if (!flowId) {
    return (
      <TerminalError
        copy={{
          title: "This page is opened from Telegram",
          hint: "Send /login in your chat to get a fresh link.",
          terminal: true,
        }}
      />
    );
  }
  if (bound) {
    return (
      <BindSuccess agentName={bound.agentName} chatTitle={bound.chatTitle} />
    );
  }
  if (error?.terminal) {
    return <TerminalError copy={error} />;
  }
  if (agents.isLoading) {
    return (
      <Page title="Connect this chat to an agent">
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
          setBound({ agentName: agent.name, chatTitle: res.chatTitle }),
        onError: (e) => {
          const code = (e as { data?: { code?: string } }).data?.code;
          setError(bindErrorCopy(code));
        },
      },
    );
  };

  const hasAgents = displayedAgents.length > 0;

  return (
    <Page title="Connect this chat to an agent">
      <p className="text-sm text-muted-foreground">
        {hasAgents
          ? "Everyone in the chat will be able to talk to the agent you pick, using the agent's own credentials."
          : "You don't own any agents yet. Create one to connect it — everyone in the chat will then be able to talk to it, using its own credentials."}
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
  chatTitle,
}: {
  agentName: string;
  chatTitle: string | null;
}) {
  const bot = useTelegramBot();
  return (
    <Page title={chatTitle ? `“${chatTitle}” is connected` : "Chat connected"}>
      <p className="text-sm text-muted-foreground">
        The chat is now connected to <strong>{agentName}</strong>. Return to
        Telegram — the bot has posted a confirmation in your chat. Send /logout
        there to disconnect.
      </p>
      {bot.data?.username && (
        <a
          className="text-sm underline text-foreground"
          href={`https://t.me/${bot.data.username}`}
        >
          Open @{bot.data.username} in Telegram
        </a>
      )}
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
