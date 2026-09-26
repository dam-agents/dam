import { Launch } from "@carbon/icons-react";

import { getBrand } from "@/brand";
import { CopyableCommand } from "@/components/copyable-command";
import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { externalLinkProps } from "@/lib/external-link";

import { CLI_REFERENCE_URL } from "../../../constants.js";

interface Props {
  agentId: string;
  agentName: string;
  onClose: () => void;
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

export function OpenInTerminalDialog({ agentId, agentName, onClose }: Props) {
  const cli = getBrand().short;
  return (
    <Modal widthClass="w-[480px]">
      <DialogHeader
        title="Open in Terminal"
        onClose={onClose}
        subtitle={
          <>
            <code className="font-mono">{cli} chat</code> connects your terminal
            to <strong className="text-foreground">{agentName}</strong>'s
            interactive TUI.
          </>
        }
      />
      <DialogBody className="flex flex-col gap-3">
        <span className="text-sm font-medium text-foreground">
          Attach to the agent
        </span>
        <CopyableCommand command={`${cli} chat ${agentId}`} size="compact" />
        <CliQuickstartNote />
      </DialogBody>
    </Modal>
  );
}

export function OpenInIdeDialog({ agentId, agentName, onClose }: Props) {
  const cli = getBrand().short;
  return (
    <Modal widthClass="w-[480px]">
      <DialogHeader
        title="Open in VS Code / Zed"
        onClose={onClose}
        subtitle={
          <>
            <code className="font-mono">{cli} ssh connect</code> launches your
            editor against{" "}
            <strong className="text-foreground">{agentName}</strong>'s workspace
            over SSH.
          </>
        }
      />
      <DialogBody className="flex flex-col gap-3">
        <span className="text-sm font-medium text-foreground">
          Open in VS Code
        </span>
        <CopyableCommand
          command={`${cli} ssh connect -x code ${agentId}`}
          size="compact"
        />
        <span className="mt-1 text-sm font-medium text-foreground">
          Open in Zed
        </span>
        <CopyableCommand
          command={`${cli} ssh connect -x zed ${agentId}`}
          size="compact"
        />
        <CliQuickstartNote />
      </DialogBody>
    </Modal>
  );
}
