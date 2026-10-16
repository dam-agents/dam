import { Launch } from "@carbon/icons-react";

import { CopyableCommand } from "@/components/copyable-command";
import { Button } from "@/components/ui/button";

import { getBrand } from "../../../../brand.js";
import { useTelegramBot } from "../../../telegram/api/queries.js";

type BindMessenger = "slack" | "telegram";

interface BindStep {
  title: string;
  body: string;
  command?: string;
  note?: string;
}

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

export function MessengerInstructions({
  messenger,
}: {
  messenger: BindMessenger;
}) {
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
