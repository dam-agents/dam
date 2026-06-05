import { useState } from "react";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { Terminal } from "../../sessions/components/terminal.js";
import { SandboxShell } from "../components/sandbox-shell.js";

export function SandboxTerminalView() {
  const agentId = useStore((s) => s.agentId);
  const setView = useStore((s) => s.setView);
  const agents = useAgentsList();
  const agent = agents.find((a) => a.id === agentId);

  const breadcrumbs = [
    { label: "Sandboxes", onClick: () => setView("v2-list") },
    { label: agent?.name ?? "Sandbox" },
  ];

  return (
    <SandboxShell breadcrumbs={breadcrumbs}>
      {agentId ? (
        <SandboxTerminal key={agentId} agentId={agentId} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[14px] text-muted-foreground">
          No sandbox selected.
        </div>
      )}
    </SandboxShell>
  );
}

// Keyed by agentId so each sandbox gets its own fresh terminal session.
function SandboxTerminal({ agentId }: { agentId: string }) {
  const [sessionId] = useState(() => crypto.randomUUID());
  return <Terminal agentId={agentId} sessionId={sessionId} />;
}
