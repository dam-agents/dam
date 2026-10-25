import { Add } from "@carbon/icons-react";
import { useState } from "react";

import { SlackChannelExplainer } from "@/components/channel-connection-explainer";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { AddRow, ListSection } from "@/components/ui/list-section";

import { getBrand } from "../../../../brand.js";
import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import { useDisconnectSlack } from "../../../agents/api/mutations.js";
import { ConnectionIcon } from "../../../connections/components/connection-icon.js";
import type { SlackChannel } from "../../hooks/use-slack-channel-form.js";
import {
  findSlackChannels,
  isSlackConversationGone,
  slackChannelLabel,
} from "../../lib/slack-channels.js";
import { ChannelRow } from "./channel-row.js";
import { SlackChannelModal } from "./slack-channel-modal.js";
import { SlackLoopGuardNotice } from "./slack-loop-guard-notice.js";

type ModalTarget = SlackChannel | "new" | null;

export function SlackChannelCard({
  agent,
  readOnly = false,
}: {
  agent: AgentView | undefined;
  readOnly?: boolean;
}) {
  const slackChannels = findSlackChannels(agent);
  const [modalTarget, setModalTarget] = useState<ModalTarget>(null);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  return (
    <>
      <ListSection
        label={
          <span className="flex items-center gap-2">
            <ConnectionIcon iconSlug="slack" alt="" size={14} />
            Slack channels
            <SlackChannelExplainer
              onGoToConnections={
                agent
                  ? () => navigateToSandboxHome(agent.id, "connections")
                  : undefined
              }
            />
          </span>
        }
        onNew={readOnly ? undefined : () => setModalTarget("new")}
        newDisabled={!agent}
        newTestId="slack-connect"
        newLabel="Add Slack channel"
        isEmpty={!agent || slackChannels.length === 0}
        empty="No channels connected yet. Mentions of the bot in a connected channel drive this agent."
        addRow={
          !readOnly && (
            <AddRow
              onClick={() => setModalTarget("new")}
              testId="slack-connect"
            >
              <Add size={16} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-md font-medium text-foreground">
                  Add Slack channel
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  Mentions of the bot in a connected channel drive this agent.
                </p>
              </div>
            </AddRow>
          )
        }
      >
        {agent &&
          slackChannels.map((channel) => (
            <SlackChannelRow
              key={channel.slackChannelId}
              agentId={agent.id}
              channel={channel}
              readOnly={readOnly}
              onEdit={() => setModalTarget(channel)}
            />
          ))}
      </ListSection>
      {modalTarget && agent && (
        <SlackChannelModal
          agent={agent}
          channel={modalTarget === "new" ? undefined : modalTarget}
          onClose={() => setModalTarget(null)}
        />
      )}
    </>
  );
}

function SlackChannelRow({
  agentId,
  channel,
  readOnly,
  onEdit,
}: {
  agentId: string;
  channel: SlackChannel;
  readOnly: boolean;
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
    <div>
      <ChannelRow
        title={label}
        badge={
          channel.default && (
            <Badge variant="muted" className="shrink-0">
              Default
            </Badge>
          )
        }
        subtitle={
          isSlackConversationGone(channel)
            ? "No longer available in Slack. Disconnect to remove it."
            : channel.ambient
              ? "Ambient on"
              : "Ambient off"
        }
        actionsLabel={`Slack channel ${label} actions`}
        menuTestId="slack-channel-menu"
        actions={
          !readOnly && (
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
          )
        }
      />
      {channel.loopGuard && <SlackLoopGuardNotice drops={channel.loopGuard} />}
    </div>
  );
}
