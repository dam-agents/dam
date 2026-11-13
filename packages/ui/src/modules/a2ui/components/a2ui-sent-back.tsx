import { Spinner } from "@/components/ui/spinner";

import type { SentBack } from "../lib/sent-back.js";

export function A2uiSentBack({ state }: { state: SentBack }) {
  if (state === "replaced")
    return (
      <p className="text-xs italic text-muted-foreground">
        The agent answered again below instead of this form.
      </p>
    );
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <Spinner />
      The agent is fixing the form…
    </span>
  );
}
