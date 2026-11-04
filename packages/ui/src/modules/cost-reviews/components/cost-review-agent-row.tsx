import type { CostReviewOffer } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { offerSpendLine } from "../lib/cost-review-copy.js";

interface Props {
  offer: CostReviewOffer;
  name: string;
  avatar: string | null | undefined;
  starting: boolean;
  reviewDisabled: boolean;
  dismissDisabled: boolean;
  onReview: () => void;
  onDismiss: () => void;
}

export function CostReviewAgentRow({
  offer,
  name,
  avatar,
  starting,
  reviewDisabled,
  dismissDisabled,
  onReview,
  onDismiss,
}: Props) {
  return (
    <li className="flex items-center gap-2" data-testid="cost-review-agent">
      <AgentAvatar name={name} avatar={avatar} size={20} />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-sm">
        <span className="max-w-full truncate text-foreground">{name}</span>
        <span className="whitespace-nowrap text-muted-foreground">
          {offerSpendLine(offer)}
        </span>
      </div>
      {starting ? (
        <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
          <Spinner size={14} />
          Opening the review…
        </span>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="link"
            size="inline"
            disabled={dismissDisabled}
            onClick={onDismiss}
            className="text-sm"
          >
            Later
          </Button>
          <Button size="sm" disabled={reviewDisabled} onClick={onReview}>
            Find savings
          </Button>
        </div>
      )}
    </li>
  );
}
