import { Launch } from "@carbon/icons-react";

import { getBrand } from "@/brand";
import { CopyableCommand } from "@/components/copyable-command";
import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { externalLinkProps } from "@/lib/external-link";

import { CLI_REFERENCE_URL } from "../../../constants.js";

interface Props {
  agentId: string;
  onClose: () => void;
}

function CliSetupNote() {
  return (
    <p className="text-sm text-muted-foreground">
      Follow the{" "}
      <a
        href={CLI_REFERENCE_URL}
        {...externalLinkProps}
        className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
      >
        CLI quickstart <Launch size={13} />
      </a>{" "}
      to set up the {getBrand().name} CLI first.
    </p>
  );
}

function CommandDialog({
  title,
  commands,
  onClose,
}: {
  title: string;
  commands: { label: string; command: string }[];
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} size="sm">
      <DialogHeader title={title} onClose={onClose} />
      <DialogBody className="flex flex-col gap-3">
        <CliSetupNote />
        {commands.map(({ label, command }) => (
          <div key={command} className="mt-1 flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">{label}</span>
            <CopyableCommand command={command} />
          </div>
        ))}
      </DialogBody>
    </Modal>
  );
}

export function OpenInTerminalDialog({ agentId, onClose }: Props) {
  const cli = getBrand().short;
  return (
    <CommandDialog
      title="CLI and SSH"
      onClose={onClose}
      commands={[
        { label: "Open the agent TUI", command: `${cli} chat ${agentId}` },
        { label: "SSH to the agent", command: `${cli} ssh connect ${agentId}` },
      ]}
    />
  );
}

export function OpenInIdeDialog({ agentId, onClose }: Props) {
  const cli = getBrand().short;
  return (
    <CommandDialog
      title="VS Code / Zed"
      onClose={onClose}
      commands={[
        {
          label: "Open in VS Code",
          command: `${cli} ssh connect -x code ${agentId}`,
        },
        {
          label: "Open in Zed",
          command: `${cli} ssh connect -x zed ${agentId}`,
        },
      ]}
    />
  );
}
