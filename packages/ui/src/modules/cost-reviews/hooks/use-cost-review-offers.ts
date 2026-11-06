import type { CostReviewOffer, CostReviewStarted } from "api-server-api";
import { useEffect, useState } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { useAttention } from "../../home/api/queries.js";
import { useDismissCostReviews, useStartCostReview } from "../api/mutations.js";
import { DISMISSED_HINT, STILL_OPENING_HINT } from "../lib/cost-review-copy.js";
import { useCostReviewSessionId } from "./use-cost-review-session.js";

const SESSION_WAIT_MS = 120_000;

interface Opening {
  offer: CostReviewOffer;
  index: number;
  started: CostReviewStarted | null;
}

export interface CostReviewOffers {
  offers: readonly CostReviewOffer[];
  startingAgentId: string | null;
  dismissing: boolean;
  review: (agentId: string) => void;
  dismiss: (agentIds: readonly string[]) => void;
}

function withOpening(
  offers: readonly CostReviewOffer[],
  opening: Opening | null,
): readonly CostReviewOffer[] {
  if (!opening || offers.some((o) => o.agentId === opening.offer.agentId)) {
    return offers;
  }
  const at = Math.min(opening.index, offers.length);
  return [...offers.slice(0, at), opening.offer, ...offers.slice(at)];
}

export function useCostReviewOffers(): CostReviewOffers {
  const attention = useAttention();
  const start = useStartCostReview();
  const dismissOffers = useDismissCostReviews();
  const [opening, setOpening] = useState<Opening | null>(null);
  const started = opening?.started ?? null;
  const sessionId = useCostReviewSessionId(started);
  const openAgentSession = useStore((s) => s.openAgentSession);
  const offered = attention.data?.costReviews ?? [];

  useEffect(() => {
    if (!started || !sessionId) return;
    setOpening(null);
    openAgentSession(started.agentId, sessionId);
    const { sidePanelTab, setSidePanelTab } = useStore.getState();
    if (sidePanelTab === "approvals") setSidePanelTab(null);
  }, [started, sessionId, openAgentSession]);

  useEffect(() => {
    if (!started) return;
    const timer = setTimeout(() => {
      setOpening(null);
      emitToast({ kind: "info", message: STILL_OPENING_HINT });
    }, SESSION_WAIT_MS);
    return () => clearTimeout(timer);
  }, [started]);

  const review = (agentId: string) => {
    const index = offered.findIndex((o) => o.agentId === agentId);
    const offer = offered[index];
    if (!offer) return;
    setOpening({ offer, index, started: null });
    start.mutate(agentId, {
      onSuccess: (result) =>
        setOpening((o) =>
          o?.offer.agentId === agentId ? { ...o, started: result } : o,
        ),
      onError: () =>
        setOpening((o) => (o?.offer.agentId === agentId ? null : o)),
    });
  };

  return {
    offers: withOpening(offered, opening),
    startingAgentId: opening?.offer.agentId ?? null,
    dismissing: dismissOffers.isPending,
    review,
    dismiss: (agentIds) =>
      dismissOffers.mutate(agentIds, {
        onSuccess: () => emitToast({ kind: "info", message: DISMISSED_HINT }),
      }),
  };
}
