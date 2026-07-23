import { useState } from "react";

import { Button } from "@/components/ui/button";

import { getBrand } from "../../../brand.js";
import { ListSkeleton } from "../../../components/list-skeleton.js";
import type { AgentView } from "../../../types.js";
import { BindAgentRow } from "../../agents/components/bind-agent-row.js";
import { CreateAgentInline } from "../../agents/components/create-agent-inline.js";
import { useInlineAgentCreate } from "../../agents/hooks/use-inline-agent-create.js";
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
  const bind = useBindSlackChannel();
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
    channelTitle: string | null;
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
  if (isLoading) {
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
        <button
          type="button"
          onClick={openCreateForm}
          className="self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          + Create a new agent
        </button>
      ) : null}
    </Page>
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
