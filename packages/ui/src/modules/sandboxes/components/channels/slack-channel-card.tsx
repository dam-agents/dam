import { Add } from "@carbon/icons-react";
import { useState } from "react";

import { SlackChannelExplainer } from "@/components/channel-connection-explainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

import { getBrand } from "../../../../brand.js";
import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import { useDisconnectSlack } from "../../../agents/api/mutations.js";
import type { SlackChannel } from "../../hooks/use-slack-channel-form.js";
import {
  findSlackChannels,
  slackChannelLabel,
} from "../../hooks/use-slack-channel-form.js";
import { ChannelCard } from "./channel-card.js";
import { ChannelRow } from "./channel-row.js";
import { SlackChannelModal } from "./slack-channel-modal.js";

type ModalTarget = SlackChannel | "new" | null;

export function SlackChannelCard({ agent }: { agent: AgentView | undefined }) {
  const slackChannels = findSlackChannels(agent);
  const [modalTarget, setModalTarget] = useState<ModalTarget>(null);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  return (
    <ChannelCard
      iconSlug="slack"
      title="Slack Channel"
      titleAccessory={
        <SlackChannelExplainer
          onGoToConnections={
            agent
              ? () => navigateToSandboxHome(agent.id, "connections")
              : undefined
          }
        />
      }
    >
      <div className="flex flex-col items-start gap-3 px-4 py-4">
        {agent && slackChannels.length > 0 ? (
          <div className="flex w-full flex-col gap-2">
            {slackChannels.map((channel) => (
              <SlackChannelRow
                key={channel.slackChannelId}
                agentId={agent.id}
                channel={channel}
                onEdit={() => setModalTarget(channel)}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No channels connected yet. Mentions of the bot in a connected
            channel drive this agent.
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setModalTarget("new")}
          disabled={!agent}
          data-testid="slack-connect"
        >
          <Add size={16} />
          Connect channel
        </Button>
      </div>
      {modalTarget && agent && (
        <SlackChannelModal
          agent={agent}
          channel={modalTarget === "new" ? undefined : modalTarget}
          onClose={() => setModalTarget(null)}
        />
      )}
    </ChannelCard>
  );
}

function SlackChannelRow({
  agentId,
  channel,
  onEdit,
}: {
  agentId: string;
  channel: SlackChannel;
  onEdit: () => void;
}) {
  const showConfirm = useStore((s) => s.showConfirm);
  const disconnectSlack = useDisconnectSlack();

  const brandShort = getBrand().short;
  const label = slackChannelLabel(channel);

  const handleDisconnect = async () => {
    if (
      await showConfirm(
        <p>
          Mentions in <strong>{label}</strong> will stop reaching this agent.
          {channel.default ? (
            <>
              {" "}
              It is that channel&apos;s default agent, so mentions with no agent
              name will reach no one until an agent&apos;s owner runs{" "}
              <code>/{brandShort} default &lt;agent&gt;</code> in Slack.
            </>
          ) : null}
        </p>,
        "Disconnect Slack channel?",
        { kind: "destructive", confirmLabel: "Disconnect" },
      )
    )
      disconnectSlack.mutate({
        id: agentId,
        slackChannelId: channel.slackChannelId,
      });
  };

  return (
    <ChannelRow
      title={label}
      badge={
        channel.default && (
          <Badge variant="muted" className="shrink-0">
            Default
          </Badge>
        )
      }
      subtitle={channel.ambient ? "Ambient on" : "Ambient off"}
      actionsLabel={`Slack channel ${label} actions`}
      menuTestId="slack-channel-menu"
      actions={
        <>
          <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
          <DropdownMenuItem
            tone="danger"
            disabled={disconnectSlack.isPending}
            onSelect={() => void handleDisconnect()}
          >
            Disconnect
          </DropdownMenuItem>
        </>
      }
    />
  );
}
