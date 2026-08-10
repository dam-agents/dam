import { Code, Terminal } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import {
  OpenInIdeDialog,
  OpenInTerminalDialog,
} from "../../sandboxes/components/open-in-dialogs.js";

type LocalTarget = "terminal" | "ide";

/** The other ways into a sandbox, offered beside the message box: chat is the
 *  default now, so these sit where a new session starts rather than behind a
 *  menu on a page the user no longer passes through. */
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

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" onClick={onNewTerminal}>
          <Terminal size={14} /> Terminal (browser)
        </Button>
        <Button variant="outline" onClick={() => setDialog("terminal")}>
          <Terminal size={14} /> Terminal (local)
        </Button>
        <Button variant="outline" onClick={() => setDialog("ide")}>
          <Code size={14} /> Vs Code / Zed (local)
        </Button>
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
