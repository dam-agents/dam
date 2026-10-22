import { Launch } from "@carbon/icons-react";
import type { OutageAlertNotice } from "api-server-api";

import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";

import { timeAgo } from "../../../lib/format-time.js";
import type { AgentView } from "../../../types.js";
import { providerNameFor } from "../../provider-status/lib/provider-name.js";
import {
  outageAlertCopy,
  outageAlertDismissHint,
} from "../lib/outage-alert-copy.js";
import { FeedNoticeCard } from "./feed-notice-card.js";
import { OutageAlertAgents } from "./outage-alert-agents.js";

interface Props {
  alert: OutageAlertNotice;
  agentOf: (agentId: string) => AgentView | undefined;
  now: Date;
  onDismiss: () => void;
}

export function FeedOutageAlertCard({ alert, agentOf, now, onDismiss }: Props) {
  const provider = providerNameFor(alert.templateId) ?? alert.templateId;
  const recovered = alert.recoveredAt !== null;
  const { meta, headline, detail } = outageAlertCopy(alert, provider);

  return (
    <FeedNoticeCard
      testId="feed-outage-alert-card"
      warning={!recovered}
      meta={<span className="truncate">{meta}</span>}
      headline={headline}
      dismiss={
        recovered
          ? null
          : { title: outageAlertDismissHint(provider), onDismiss }
      }
      footerStart={timeAgo(alert.recoveredAt ?? alert.since, now)}
      footerEnd={
        <>
          {alert.statusPageUrl && (
            <Button asChild variant="link" size="inline">
              <a href={alert.statusPageUrl} {...externalLinkProps}>
                {provider} status
                <Launch size={14} />
              </a>
            </Button>
          )}
          {recovered && (
            <Button size="sm" variant="outline" onClick={onDismiss}>
              OK
            </Button>
          )}
        </>
      }
    >
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
      <OutageAlertAgents
        agents={alert.agents}
        agentOf={agentOf}
        switchable={!recovered}
      />
    </FeedNoticeCard>
  );
}
