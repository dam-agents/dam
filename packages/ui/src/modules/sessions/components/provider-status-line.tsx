import { useOutageFor } from "../../provider-status/api/queries.js";
import { statusLineCopy } from "../../provider-status/lib/copy.js";
import { providerNameFor } from "../../provider-status/lib/provider-name.js";
import { StatusLine } from "./status-line.js";

interface Props {
  templateId: string | null;
  busy: boolean;
}

export function ProviderStatusLine({ templateId, busy }: Props) {
  const condition = useOutageFor(templateId);
  const copy = statusLineCopy({
    condition,
    providerName: providerNameFor(templateId),
    busy,
  });
  if (!copy) return null;
  return (
    <StatusLine testId="provider-status-line">
      <span className="min-w-0 py-2">
        <span className="font-semibold text-foreground">{copy.lead}</span>{" "}
        <span className="text-muted-foreground">{copy.rest}</span>
      </span>
    </StatusLine>
  );
}
