import { useEffect, useState } from "react";

import { useStore } from "../../../../store.js";
import { consumeBindIntent } from "../../lib/bind-intent.js";
import { type BindMessenger, ChannelBindModal } from "./channel-bind-modal.js";

export function PendingBindModal() {
  const agentId = useStore((s) => s.selectedAgent);
  const [pending, setPending] = useState<{
    agentId: string;
    messengers: BindMessenger[];
  } | null>(null);

  useEffect(() => {
    if (!agentId) return;
    const messengers = consumeBindIntent(agentId);
    if (messengers) setPending({ agentId, messengers });
  }, [agentId]);

  if (!pending) return null;
  return (
    <ChannelBindModal
      messengers={pending.messengers}
      onClose={() => setPending(null)}
    />
  );
}
