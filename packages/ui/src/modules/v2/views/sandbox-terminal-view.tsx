import { Loader2 } from "lucide-react";
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
  // Cleared on the first output frame, not on socket open: the relay completes
  // the client handshake immediately and only then wakes the agent, so the
  // overlay must stay up through the wake until the shell actually responds.
  const [ready, setReady] = useState(false);
  return (
    <div className="relative flex flex-1 min-h-0">
      <Terminal
        agentId={agentId}
        sessionId={sessionId}
        onFirstOutput={() => setReady(true)}
      />
      {!ready && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-stone-900/90 backdrop-blur-sm">
          <div className="flex items-center gap-3 text-[14px] text-stone-300">
            <Loader2 size={18} className="animate-spin" />
            Starting sandbox…
          </div>
        </div>
      )}
    </div>
  );
}
