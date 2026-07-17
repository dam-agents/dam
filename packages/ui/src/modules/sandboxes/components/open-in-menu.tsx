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

function DialogTitle({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h2 className="text-[18px] font-bold">{title}</h2>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X size={18} />
      </button>
    </div>
  );
}

function CliQuickstartNote() {
  return (
    <p className="text-[13px] text-muted-foreground">
      First time? Installing the CLI and logging in is covered in the{" "}
      <a
        href={CLI_REFERENCE_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
      >
        CLI quickstart <ExternalLink size={13} />
      </a>
    </p>
  );
}

function OpenInTerminalDialog({
  agent,
  onClose,
}: {
  agent: AgentView;
  onClose: () => void;
}) {
  return (
    <Modal widthClass="w-[480px]">
      <DialogHeader>
        <DialogTitle title="Open in Terminal" onClose={onClose} />
        <p className="mt-1 text-[13px] text-muted-foreground">
          <code className="font-mono">dam chat</code> connects your terminal to{" "}
          <strong className="text-foreground">{agent.name}</strong>'s
          interactive TUI.
        </p>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3">
        <span className="text-[13px] font-medium text-foreground">
          Attach to the sandbox
        </span>
        <CopyableCommand command={`dam chat ${agent.id}`} />
        <CliQuickstartNote />
      </DialogBody>
    </Modal>
  );
}

function OpenInIdeDialog({
  agent,
  onClose,
}: {
  agent: AgentView;
  onClose: () => void;
}) {
  return (
    <Modal widthClass="w-[480px]">
      <DialogHeader>
        <DialogTitle title="Open in IDE" onClose={onClose} />
        <p className="mt-1 text-[13px] text-muted-foreground">
          <code className="font-mono">dam ssh connect</code> launches your
          editor against{" "}
          <strong className="text-foreground">{agent.name}</strong>'s workspace
          over SSH.
        </p>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3">
        <span className="text-[13px] font-medium text-foreground">
          Open in VS Code
        </span>
        <CopyableCommand command={`dam ssh connect -x code ${agent.id}`} />
        <span className="mt-1 text-[13px] font-medium text-foreground">
          Open in Zed
        </span>
        <CopyableCommand command={`dam ssh connect -x zed ${agent.id}`} />
        <CliQuickstartNote />
      </DialogBody>
    </Modal>
  );
}
