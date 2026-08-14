import { useState } from "react";

import { Button } from "@/components/ui/button";

import { getBrand } from "../../../brand.js";
import { ListSkeleton } from "../../../components/list-skeleton.js";
import type { AgentView } from "../../../types.js";
import { BindAgentRow } from "../../agents/components/bind-agent-row.js";
import { CreateAgentInline } from "../../agents/components/create-agent-inline.js";
import { useInlineAgentCreate } from "../../agents/hooks/use-inline-agent-create.js";
import { useBindTelegramChat } from "../api/mutations.js";
import { useTelegramBot } from "../api/queries.js";
import {
  type BindErrorCopy,
  bindErrorCopy,
  callbackErrorCopy,
  readCallbackErrorFromSearch,
  readFlowIdFromSearch,
} from "../lib/bind-flow.js";

const flowId = readFlowIdFromSearch(window.location.search);
const callbackError = readCallbackErrorFromSearch(window.location.search);

export function TelegramBindView() {
  const brandShort = getBrand().short;
  const bind = useBindTelegramChat();
  const {
    isLoading,
    displayedAgents,
    justCreatedId,
    creating,
    openCreateForm,
    markCreated,
  } = useInlineAgentCreate();
  const [error, setError] = useState<BindErrorCopy | null>(null);
  const [bound, setBound] = useState<{
    agentName: string;
    chatTitle: string | null;
  } | null>(null);

  const handleCreated = (agent: AgentView) => {
    markCreated(agent);
    setError(null);
  };

  if (callbackError) {
    return (
      <TerminalError copy={callbackErrorCopy(callbackError, brandShort)} />
    );
  }
  if (!flowId) {
    return (
      <TerminalError
        copy={{
          title: "This page is opened from Telegram",
          hint: `Send \`/${brandShort} bind\` in your chat to get a fresh link.`,
          terminal: true,
        }}
      />
    );
  }
  if (bound) {
    return (
      <BindSuccess
        agentName={bound.agentName}
        chatTitle={bound.chatTitle}
        brandShort={brandShort}
      />
    );
  }
  if (error?.terminal) {
    return <TerminalError copy={error} />;
  }
  if (isLoading) {
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
          setError(bindErrorCopy(code, brandShort));
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
              highlighted={agent.id === justCreatedId}
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
        <Button
          variant="link"
          size="inline"
          onClick={openCreateForm}
          className="self-start text-sm text-muted-foreground hover:text-foreground"
        >
          + Create a new agent
        </Button>
      ) : null}
    </Page>
  );
}

function BindSuccess({
  agentName,
  chatTitle,
  brandShort,
}: {
  agentName: string;
  chatTitle: string | null;
  brandShort: string;
}) {
  const bot = useTelegramBot();
  return (
    <Page title={chatTitle ? `“${chatTitle}” is connected` : "Chat connected"}>
      <p className="text-sm text-muted-foreground">
        The chat is now connected to <strong>{agentName}</strong>. Return to
        Telegram — the bot has posted a confirmation in your chat. Send{" "}
        <code>/{brandShort} unbind</code> there to disconnect.
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
