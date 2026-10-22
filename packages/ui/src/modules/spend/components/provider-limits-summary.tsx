import type { SpendLimitView } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useAppConnections } from "../../connections/api/queries.js";
import {
  EDIT_IN_PROVIDERS,
  percentOfLimit,
  PROVIDER_LIMITS_HELP,
  PROVIDER_LIMITS_TITLE,
  spentOfLimit,
} from "../lib/copy.js";
import { connectionDisplayName } from "../lib/level-labels.js";
import type { LevelConnection } from "../lib/limit-levels.js";
import { HelpTip } from "./help-tip.js";
import { LevelIcon } from "./level-icon.js";
import { LimitBar } from "./limit-bar.js";

export function ProviderLimitsSummary({
  limits,
}: {
  limits: readonly SpendLimitView[];
}) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const { data: connections } = useAppConnections();
  const providerLimits = limits.filter(
    (limit) => limit.scope.kind === "owner-connection",
  );
  if (providerLimits.length === 0) return null;
  const connectionOf = (connectionId: string) => {
    const found = connections?.find((c) => c.id === connectionId);
    return {
      id: connectionId,
      name: connectionDisplayName(
        found?.name ?? connectionId,
        found?.templateId ?? "",
      ),
      templateId: found?.templateId ?? "",
    };
  };

  return (
    <div className="flex flex-col gap-2.5 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {PROVIDER_LIMITS_TITLE}
          <HelpTip content={PROVIDER_LIMITS_HELP} />
        </p>
        <Button
          variant="link"
          size="inline"
          className="text-xs"
          onClick={() => navigateToSettings("providers")}
        >
          {EDIT_IN_PROVIDERS}
        </Button>
      </div>
      <ul className="grid grid-cols-[20px_auto_1fr] items-center gap-x-2.5 gap-y-2">
        {providerLimits.map((limit) => (
          <ProviderLimitRow
            key={limit.id}
            limit={limit}
            connection={
              limit.scope.kind === "owner-connection"
                ? connectionOf(limit.scope.connectionId)
                : null
            }
          />
        ))}
      </ul>
    </div>
  );
}

function ProviderLimitRow({
  limit,
  connection,
}: {
  limit: SpendLimitView;
  connection: LevelConnection | null;
}) {
  const name = connection?.name ?? "";
  const amounts = spentOfLimit(
    limit.spentMicros,
    limit.amountMicros,
    limit.unit,
  );
  return (
    <li className="contents">
      <LevelIcon
        level={{
          key: limit.id,
          kind: "all-connection",
          connection,
          unit: limit.unit,
          amountMicros: limit.amountMicros,
          extensions: limit.extensions,
          effectiveMicros: limit.effectiveMicros,
          spentMicros: limit.spentMicros,
          leftMicros: limit.leftMicros,
          state: limit.state,
          mineMicros: null,
          stopsFirst: false,
        }}
        agent={null}
      />
      <span className="text-xs text-foreground">{name}</span>
      <div className="flex flex-col gap-0.5">
        <LimitBar
          pct={percentOfLimit(limit.spentMicros, limit.effectiveMicros)}
          state={limit.state}
          label={`${name}: ${amounts} today`}
          size="sm"
        />
        <span className="text-[11px] text-muted-foreground/80 tabular-nums">
          {amounts}
        </span>
      </div>
    </li>
  );
}
