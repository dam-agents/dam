import type { AgentView } from "../../../types.js";
import { FeedNoticeCard } from "../../home/components/feed-notice-card.js";
import type { CostReviewOffers } from "../hooks/use-cost-review-offers.js";
import { costReviewHeadline, OFFER_FOOTER } from "../lib/cost-review-copy.js";
import { CostReviewAgentRow } from "./cost-review-agent-row.js";

interface Props {
  view: CostReviewOffers;
  agentOf: (agentId: string) => AgentView | undefined;
}

export function FeedCostReviewCard({ view, agentOf }: Props) {
  const nameOf = (agentId: string) => agentOf(agentId)?.name ?? agentId;
  const { offers } = view;
  return (
    <FeedNoticeCard
      testId="feed-cost-review-card"
      warning={false}
      meta={<span className="truncate">Cost review</span>}
      headline={costReviewHeadline(offers, nameOf)}
      dismiss={
        view.startingAgentId !== null || view.dismissing
          ? null
          : {
              title: "Asks again later for every agent here.",
              onDismiss: () => view.dismiss(offers.map((o) => o.agentId)),
            }
      }
      footerStart={OFFER_FOOTER}
      footerEnd={null}
    >
      <p className="mt-2 text-sm text-muted-foreground">
        Spend in the past week. The agent checks its recent runs and suggests
        what to change. It takes one chat session, and nothing changes unless
        you agree.
      </p>
      {offers.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 rounded-md border border-border/50 bg-muted/40 px-2.5 py-1.5">
          {offers.map((offer) => {
            const agent = agentOf(offer.agentId);
            return (
              <CostReviewAgentRow
                key={offer.agentId}
                offer={offer}
                name={nameOf(offer.agentId)}
                avatar={agent?.avatar}
                starting={view.startingAgentId === offer.agentId}
                reviewDisabled={
                  view.dismissing || view.startingAgentId !== null
                }
                dismissDisabled={view.dismissing}
                onReview={() => view.review(offer.agentId)}
                onDismiss={() => view.dismiss([offer.agentId])}
              />
            );
          })}
        </ul>
      )}
    </FeedNoticeCard>
  );
}
