import { Warning } from "@carbon/icons-react";

import { formatBytes } from "@/lib/format-size";

import { ChatColumn } from "../../sessions/components/chat-column.js";
import { useHomeVolume } from "../api/queries.js";

export function HomeVolumeBar({ agentId }: { agentId: string | null }) {
  const { data: volume } = useHomeVolume(agentId);
  if (!volume?.full) return null;
  return (
    <div className="px-4 md:px-8" data-testid="home-volume-bar">
      <ChatColumn>
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-light px-4 py-2 text-sm text-danger"
        >
          <Warning size={16} className="mt-0.5 shrink-0" />
          <span>
            This agent's storage is full ({formatBytes(volume.freeBytes)} free
            of {formatBytes(volume.totalBytes)}). The agent can't save its work
            until you delete files in the Files panel.
          </span>
        </div>
      </ChatColumn>
    </div>
  );
}
