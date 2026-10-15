import { useState } from "react";

import { DisclosureToggle } from "@/components/ui/disclosure";

import { useInstallCapabilities } from "../../features/api/queries.js";
import { isFeatureOffered } from "../../features/lib/visible-features.js";

interface Props {
  source: string;
}

export function A2uiFormsOff({ source }: Props) {
  const [open, setOpen] = useState(false);
  const { data: install } = useInstallCapabilities();
  const offered =
    install === undefined || isFeatureOffered("chat-forms", install);
  return (
    <div className="not-prose flex flex-col gap-1.5 text-xs text-muted-foreground">
      <DisclosureToggle
        open={open}
        onToggle={() => setOpen((value) => !value)}
        chevronSize={12}
        className="gap-1.5 hover:text-foreground"
      >
        {offered
          ? "The agent sent a form. Turn on Chat forms in Experimental features to use it."
          : "The agent sent a form, but chat forms are off on this install."}
      </DisclosureToggle>
      {open && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono">
          {source.trim()}
        </pre>
      )}
    </div>
  );
}
