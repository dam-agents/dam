import { Warning } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";

export function StaleModelNotice({
  model,
  comingUp,
  onStartAndFix,
}: {
  model: string;
  comingUp: boolean;
  onStartAndFix: () => void;
}) {
  return (
    <Notice
      tone="warning"
      icon={Warning}
      title="The saved model isn’t offered by the current provider."
      action={
        <Button size="sm" disabled={comingUp} onClick={onStartAndFix}>
          {comingUp && <Spinner size={14} />}
          {comingUp ? "Starting…" : "Start and fix"}
        </Button>
      }
    >
      This agent is set to <span className="font-mono">{model}</span>, which
      isn&rsquo;t in the provider&rsquo;s model list. Chatting will fail until
      it&rsquo;s changed.
    </Notice>
  );
}
