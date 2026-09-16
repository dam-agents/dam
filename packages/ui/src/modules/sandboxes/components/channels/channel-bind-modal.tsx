import { Copy as CopyIcon, Launch } from "@carbon/icons-react";
import { useState } from "react";

import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";

import { getBrand } from "../../../../brand.js";
import { useCopy } from "../../../../hooks/use-copy.js";
import { ConnectionIcon } from "../../../connections/components/connection-icon.js";
import { useTelegramBot } from "../../../telegram/api/queries.js";

export type BindMessenger = "slack" | "telegram";

interface BindStep {
  title: string;
  body: string;
  command?: string;
  note?: string;
}

const MESSENGER_TITLE: Record<BindMessenger, string> = {
  slack: "Add to Slack Channel",
  telegram: "Add to Telegram Chat",
};

function slackSteps(brandName: string, brandShort: string): BindStep[] {
  return [
    {
      title: "Invite the bot to your channel (to DM, skip this step)",
      body: "In the Slack channel your team already uses, run:",
      command: `/invite @${brandName}`,
    },
    {
      title: "Run the bind command there",
      body: "Then, in the same channel, run:",
      command: `/${brandShort} bind`,
    },
    {
      title: "Pick this agent on the page Slack opens",
      body: "Follow the link Slack posts, pick this agent, and confirm. That confirmation grants the access.",
    },
  ];
}

function telegramSteps(): BindStep[] {
  return [
    {
      title: "Add the bot to your chat",
      body: "Add this installation's Telegram bot to the Telegram group your team already uses. For a one-to-one chat, open it directly.",
    },
    {
      title: "Send the bind command there",
      body: "In that chat, send:",
      command: "/bind",
      note: "In a group, only admins can run this.",
    },
    {
      title: "Pick this agent on the page Telegram opens",
      body: "Follow the link the bot posts, pick this agent, and confirm. That confirmation grants the access. The link works for about 10 minutes.",
    },
  ];
}

export function ChannelBindModal({
  messengers,
  onClose,
}: {
  messengers: BindMessenger[];
  onClose: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const messenger = messengers[stepIndex] ?? messengers[0];
  if (!messenger) return null;

  const total = messengers.length;
  const isLast = stepIndex === total - 1;
  const next = messengers[stepIndex + 1];

  return (
    <Modal onClose={onClose}>
      <DialogHeader
        divided
        title={
          <span className="flex items-center gap-2">
            <ConnectionIcon iconSlug={messenger} alt="" size={20} />
            {MESSENGER_TITLE[messenger]}
          </span>
        }
        subtitle={total > 1 ? `Step ${stepIndex + 1} of ${total}` : undefined}
        onClose={onClose}
      />
      <DialogBody>
        <MessengerInstructions messenger={messenger} />
      </DialogBody>
      <div className="flex justify-end gap-2 px-5 pb-5 md:px-6 md:pb-6">
        {stepIndex > 0 && (
          <Button variant="ghost" onClick={() => setStepIndex(stepIndex - 1)}>
            Back
          </Button>
        )}
        {total > 1 && stepIndex === 0 && (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )}
        {isLast ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <Button onClick={() => setStepIndex(stepIndex + 1)}>
            Set up {next === "telegram" ? "Telegram" : "Slack"} next
          </Button>
        )}
      </div>
    </Modal>
  );
}

function MessengerInstructions({ messenger }: { messenger: BindMessenger }) {
  const brand = getBrand();
  const telegramBot = useTelegramBot();
  const handle = telegramBot.data?.username;
  const steps =
    messenger === "slack"
      ? slackSteps(brand.name, brand.short)
      : telegramSteps();

  return (
    <ol className="flex flex-col gap-5">
      {steps.map((step, index) => (
        <li key={step.title} className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            {index + 1}. {step.title}
          </p>
          <p className="text-sm text-muted-foreground">{step.body}</p>
          {step.command && <CopyableCommand command={step.command} />}
          {step.note && (
            <p className="text-sm text-muted-foreground">{step.note}</p>
          )}
          {messenger === "telegram" && index === 0 && handle && (
            <a
              href={`https://t.me/${handle}`}
              target="_blank"
              rel="noreferrer"
              className="w-fit"
            >
              <Button variant="outline" size="sm">
                Open @{handle} in Telegram <Launch size={14} />
              </Button>
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}

function CopyableCommand({ command }: { command: string }) {
  const { copy, copied } = useCopy();
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
      <code className="truncate font-mono text-sm">{command}</code>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void copy(command)}
        aria-label={`Copy ${command}`}
      >
        <CopyIcon size={14} /> {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
