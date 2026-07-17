import { useState } from "react";

import { Button } from "@/components/ui/button";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import type { AgentView } from "../../../types.js";
import { useAgents, useAgentsList } from "../../agents/api/queries.js";
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
  if (list.length === 0) {
    return (
      <Page title="Connect this chat to an agent">
        <p className="text-sm text-muted-foreground">
          You don&apos;t own any agents yet. Create an agent first, then send
          /login in the chat again.
        </p>
        <DashboardButton label="Go to dashboard" />
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

  return (
    <Page title="Connect this chat to an agent">
      <p className="text-sm text-muted-foreground">
        Everyone in the chat will be able to talk to the agent you pick, using
        the agent&apos;s own credentials.
      </p>
      {error && (
        <p className="text-sm text-red-600">
          {error.title} — {error.hint}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {list.map((agent) => (
          <BindAgentRow
            key={agent.id}
            agent={agent}
            disabled={bind.isPending}
            pending={bind.isPending && bind.variables?.agentId === agent.id}
            onPick={() => pick(agent)}
          />
        ))}
      </div>
    </Page>
  );
}

function BindAgentRow({
  agent,
  disabled,
  pending,
  onPick,
}: {
  agent: AgentView;
  disabled: boolean;
  pending: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className="flex flex-col items-start gap-0.5 rounded-lg border border-border bg-background px-4 py-3 text-left hover:border-foreground/40 disabled:opacity-60"
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
