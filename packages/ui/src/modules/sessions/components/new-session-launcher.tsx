import { Code, Terminal } from "@carbon/icons-react";
import type { CarbonIconType } from "@carbon/icons-react";
import { useState } from "react";

import { cardSelectionVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { openBindModal } from "../../sandboxes/components/channels/bind-modal-state.js";
import {
  OpenInIdeDialog,
  OpenInTerminalDialog,
} from "../../sandboxes/components/open-in-dialogs.js";

function IconTile({ icon: Icon }: { icon: CarbonIconType }) {
  return (
    <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-card">
      <Icon className="size-5 text-muted-foreground" />
    </div>
  );
}

function ImgTile({ slug }: { slug: string }) {
  return (
    <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-card">
      <ConnectionIcon iconSlug={slug} alt="" size={20} />
    </div>
  );
}

type LocalTarget = "terminal" | "ide";

export function NewSessionLauncher({
  agentId,
  agentName,
  onNewTerminal,
}: {
  agentId: string;
  agentName: string;
  onNewTerminal: () => void;
}) {
  const [dialog, setDialog] = useState<LocalTarget | null>(null);

  const tiles = [
    {
      icon: <IconTile icon={Terminal} />,
      title: "Browser Terminal",
      desc: "Interactive session in this tab",
      action: () => onNewTerminal(),
    },
    {
      icon: <IconTile icon={Terminal} />,
      title: "Local Terminal",
      desc: "SSH into the agent from your machine",
      action: () => setDialog("terminal"),
    },
    {
      icon: <IconTile icon={Code} />,
      title: "VS Code / Zed",
      desc: "Open workspace in your local editor",
      action: () => setDialog("ide"),
    },
    {
      icon: <ImgTile slug="slack" />,
      title: "Slack Channel",
      desc: "Mention the agent in a connected channel",
      action: () => openBindModal(["slack"], { initialKind: "slack" }),
    },
  ];

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3 w-full max-w-[680px] text-left">
        {tiles.map((t) => (
          <div
            key={t.title}
            className={cn(
              cardSelectionVariants({ selected: false }),
              "relative cursor-pointer bg-gradient-to-br from-muted/60 to-transparent p-4",
            )}
          >
            <button
              type="button"
              aria-label={t.title}
              onClick={t.action}
              className="absolute inset-0 rounded-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <div className="pointer-events-none relative flex flex-col gap-3">
              {t.icon}
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t.title}
                </p>
                <p className="text-[13px] text-muted-foreground">{t.desc}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {dialog === "terminal" && (
        <OpenInTerminalDialog
          agentId={agentId}
          agentName={agentName}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "ide" && (
        <OpenInIdeDialog
          agentId={agentId}
          agentName={agentName}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
