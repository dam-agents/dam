import { Sigma } from "@carbon/icons-react";
import type { SpendStatus } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useOwnerSpendStatus } from "../api/queries.js";
import {
  ALL_YOUR_AGENTS,
  EDIT_IN_PROVIDERS,
  OWN_LIMIT_DESCRIPTION,
  OWN_LIMIT_HELP,
} from "../lib/copy.js";
import { connectionDisplayName, inListOrder } from "../lib/level-labels.js";
import { ownerConnectionLevels, totalLevels } from "../lib/limit-levels.js";
import { unitTotals } from "../lib/measured-spend.js";
import { DailyLimitCard, DailyLimitCardPending } from "./daily-limit-card.js";
import { DailyLimitMeter } from "./daily-limit-meter.js";
import { LimitRowList } from "./limit-row.js";
import { SpendLimitButton } from "./spend-limit-button.js";

export function OwnSpendLimitCard() {
  const { data: status, isError } = useOwnerSpendStatus();
  if (!status) {
    return <DailyLimitCardPending help={OWN_LIMIT_HELP} failed={isError} />;
  }
  return <OwnSpendLimitBody status={status} />;
}

function OwnSpendLimitBody({ status }: { status: SpendStatus }) {
  const own = status.limits.find((view) => view.scope.kind === "owner");

  return (
    <DailyLimitCard
      help={OWN_LIMIT_HELP}
      description={OWN_LIMIT_DESCRIPTION}
      resetsAt={status.resetsAt}
      list={<OtherLimits status={status} />}
      action={
        <SpendLimitButton
          scope={{ kind: "owner" }}
          subject={ALL_YOUR_AGENTS}
          amountMicros={own?.amountMicros ?? null}
        />
      }
    >
      <DailyLimitMeter
        spentMicros={unitTotals(status.spent).usd}
        limit={own}
        resetsAt={status.resetsAt}
        subject={ALL_YOUR_AGENTS}
        icon={<Sigma size={16} />}
      />
    </DailyLimitCard>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: under the own limit, every other limit that counts the owner's agents, always shown: each provider's limit for all agents, then the operator's spend ceiling. */
function OtherLimits({ status }: { status: SpendStatus }) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const { data: connections } = useAppConnections();
  const providers = ownerConnectionLevels(status, (connectionId) => {
    const found = connections?.find((c) => c.id === connectionId);
    const templateId = found?.templateId ?? "";
    return {
      id: connectionId,
      name: connectionDisplayName(found?.name ?? connectionId, templateId),
      templateId,
    };
  });
  const levels = inListOrder([
    ...providers,
    ...totalLevels(status).others.map(({ level }) => level),
  ]);
  if (levels.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <LimitRowList levels={levels} agent={null} />
      {providers.length > 0 && (
        <Button
          variant="link"
          size="inline"
          className="self-end text-xs"
          onClick={() => navigateToSettings("providers")}
        >
          {EDIT_IN_PROVIDERS}
        </Button>
      )}
    </div>
  );
}
