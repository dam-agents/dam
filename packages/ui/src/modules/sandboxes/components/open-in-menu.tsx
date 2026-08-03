import { Chat, ChevronDown, Code, Launch, Terminal } from "@carbon/icons-react";
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
import { externalLinkProps } from "@/lib/external-link";

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

function CliQuickstartNote() {
  return (
    <p className="text-sm text-muted-foreground">
      First time? Installing the CLI and logging in is covered in the{" "}
      <a
        href={CLI_REFERENCE_URL}
        {...externalLinkProps}
        className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
      >
        CLI quickstart <Launch size={13} />
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
      <DialogHeader
        title="Open in Terminal"
        onClose={onClose}
        subtitle={
          <>
            <code className="font-mono">dam chat</code> connects your terminal
            to <strong className="text-foreground">{agent.name}</strong>'s
            interactive TUI.
          </>
        }
      />
      <DialogBody className="flex flex-col gap-3">
        <span className="text-sm font-medium text-foreground">
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
      <DialogHeader
        title="Open in IDE"
        onClose={onClose}
        subtitle={
          <>
            <code className="font-mono">dam ssh connect</code> launches your
            editor against{" "}
            <strong className="text-foreground">{agent.name}</strong>'s
            workspace over SSH.
          </>
        }
      />
      <DialogBody className="flex flex-col gap-3">
        <span className="text-sm font-medium text-foreground">
          Open in VS Code
        </span>
        <CopyableCommand command={`dam ssh connect -x code ${agent.id}`} />
        <span className="mt-1 text-sm font-medium text-foreground">
          Open in Zed
        </span>
        <CopyableCommand command={`dam ssh connect -x zed ${agent.id}`} />
        <CliQuickstartNote />
      </DialogBody>
    </Modal>
  );
}
