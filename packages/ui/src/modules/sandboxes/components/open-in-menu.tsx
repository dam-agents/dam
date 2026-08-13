import { Chat, ChevronDown, Code, Terminal } from "@carbon/icons-react";
import { ExternalLink, X } from "lucide-react";
import { useState } from "react";

import { CopyableCommand } from "@/components/copyable-command";
import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { CLI_REFERENCE_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";

type OpenInDialog = "terminal" | "ide";

/** Header "Open in" launch menu: every way to reach the agent. The two local
 *  options open a dialog with a copyable CLI command (keyed on the agent id —
 *  stable and shell-quote-free). */
export function OpenInMenu({ agent }: { agent: AgentView }) {
  const selectAgent = useStore((s) => s.selectAgent);
  const openAgentTerminal = useStore((s) => s.openAgentTerminal);
  const [dialog, setDialog] = useState<OpenInDialog | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            Open in <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => selectAgent(agent.id)}>
            <Chat /> Chat (browser)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openAgentTerminal(agent.id)}>
            <Terminal /> Terminal (browser)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("terminal")}>
            <Terminal /> Terminal (local)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("ide")}>
            <Code /> VS Code / Zed (local)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "terminal" && (
        <OpenInTerminalDialog agent={agent} onClose={() => setDialog(null)} />
      )}
      {dialog === "ide" && (
        <OpenInIdeDialog agent={agent} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

export function OpenInTerminalDialog({
  agent,
  onClose,
}: {
  agent: AgentView;
  onClose: () => void;
}) {
  return (
    <Modal widthClass="w-[480px]">
      <DialogHeader className="border-b border-border">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[16px] font-bold text-foreground">
              Open in Terminal
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
              dam chat connects your terminal to{" "}
              <strong className="font-semibold text-foreground">
                {agent.name}
              </strong>
              's interactive TUI.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5">
        <div className="space-y-2">
          <p className="text-[14px] font-medium text-foreground">
            Attach to the sandbox
          </p>
          <CopyableCommand command={`dam chat ${agent.id}`} />
        </div>
        <p className="text-[14px] text-muted-foreground">
          First time? Installing the CLI and logging in is covered in the{" "}
          <a
            href={CLI_REFERENCE_URL}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-foreground hover:underline"
          >
            CLI quickstart <ExternalLink size={12} className="inline-block" />
          </a>
        </p>
      </DialogBody>
    </Modal>
  );
}

export function OpenInIdeDialog({
  agent,
  onClose,
}: {
  agent: AgentView;
  onClose: () => void;
}) {
  return (
    <Modal widthClass="w-[480px]">
      <DialogHeader className="border-b border-border">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[16px] font-bold text-foreground">
              Open in VS Code / Zed (local)
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
              dam ssh connect launches your editor against{" "}
              <strong className="font-semibold text-foreground">
                {agent.name}
              </strong>
              's workspace over SSH.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5">
        <div className="space-y-2">
          <p className="text-[14px] font-medium text-foreground">
            Open in VS Code
          </p>
          <CopyableCommand command={`dam ssh connect -x code ${agent.id}`} />
        </div>
        <div className="space-y-2">
          <p className="text-[14px] font-medium text-foreground">Open in Zed</p>
          <CopyableCommand command={`dam ssh connect -x zed ${agent.id}`} />
        </div>
        <p className="text-[14px] text-muted-foreground">
          First time? Installing the CLI and logging in is covered in the{" "}
          <a
            href={CLI_REFERENCE_URL}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-foreground hover:underline"
          >
            CLI quickstart <ExternalLink size={12} className="inline-block" />
          </a>
        </p>
      </DialogBody>
    </Modal>
  );
}
