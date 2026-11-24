import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import type { ToolCallCardCopy } from "../lib/tool-call-card-copy.js";
import { RefusalCountdown } from "./refusal-countdown.js";

interface Props {
  agentName: string;
  copy: ToolCallCardCopy;
  iconSlug: string | null;
  requests: number;
  expiresAt: string | null;
}

export function ToolCallHeader({
  agentName,
  copy,
  iconSlug,
  requests,
  expiresAt,
}: Props) {
  const { verb, object } = copy.title;
  return (
    <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
      {iconSlug && (
        <ConnectionIcon iconSlug={iconSlug} alt="" className="mt-1 shrink-0" />
      )}
      <div className="min-w-0 flex-[1_1_15rem]">
        <p
          data-testid="tool-call-title"
          className="text-md leading-snug text-foreground break-words"
        >
          <strong className="font-semibold">{agentName}</strong> {verb}
          {object !== null && (
            <>
              {" "}
              <strong className="font-semibold">{object}</strong>
            </>
          )}
        </p>
        <p
          data-testid="tool-call-subtitle"
          className="text-sm text-muted-foreground break-words"
        >
          {copy.subtitle}
          {requests > 1 && ` · ${String(requests)} requests`}
        </p>
      </div>
      {expiresAt !== null && <RefusalCountdown expiresAt={expiresAt} />}
    </div>
  );
}
