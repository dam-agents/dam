import { aliasForProviderType, parseQualifiedModel } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useClearScheduleChoices } from "../../schedules/api/mutations.js";
import { useSchedules } from "../../schedules/api/queries.js";
import {
  useHarnessCatalog,
  useProviderConnections,
  useRememberedPair,
} from "../../sessions/api/session-pair.js";
import { harnessDisplayName } from "../../sessions/lib/session-pair-options.js";

type ScheduleRow = NonNullable<ReturnType<typeof useSchedules>["data"]>[number];

const ownsChoices = (s: ScheduleRow) =>
  !!s.harness || !!s.model || Object.keys(s.settings ?? {}).length > 0;

const offDefault = (s: ScheduleRow) =>
  ownsChoices(s) &&
  s.inSession !== "continue" &&
  !(s.type === "once" && s.status?.lastRun);

/**
 * UNIT_BOUNDARY_DESCRIPTION: the schedules that set a harness, model or
 * settings of their own, so they do not run on the scheduled default. Each
 * one can be moved to the default, or all at once after one confirmation that
 * lists every change. A one-time task that continues its session keeps that
 * session's choices, so it is not listed.
 */
export function OffDefaultSchedules({ agentId }: { agentId: string }) {
  const { data: schedules = [] } = useSchedules(agentId);
  const { data: scheduled } = useRememberedPair(agentId, "scheduled");
  const { data: status } = useHarnessConfigStatus(agentId);
  const { data: catalog } = useHarnessCatalog();
  const { granted } = useProviderConnections(agentId);
  const showConfirm = useStore((s) => s.showConfirm);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const clear = useClearScheduleChoices();
  const rows = schedules.filter(offDefault);
  if (rows.length === 0) return null;

  const aliases = new Set(granted.map((p) => aliasForProviderType(p.type)));
  const harnessName = (name: string) =>
    harnessDisplayName(name, catalog?.harnesses) ?? name;
  const settingNames = (
    harness: string | null,
    settings: Readonly<Record<string, string>> | null,
  ) => {
    const options =
      status?.harnesses?.find((h) => h.name === harness)?.harnessConfigCatalog
        ?.options ?? [];
    return Object.entries(settings ?? {}).map(([id, value]) => {
      const option = options.find((o) => o.id === id);
      const choice = option?.choices.find((c) => c.value === value)?.name;
      return `${option?.name ?? id} ${choice ?? value}`;
    });
  };
  const describe = (s: ScheduleRow) =>
    [
      ...(s.harness ? [harnessName(s.harness)] : []),
      ...(s.model ? [s.model] : []),
      ...settingNames(s.harness ?? scheduled?.harness ?? null, s.settings),
    ].join(" · ");
  const failing = (s: ScheduleRow) => {
    const alias = s.model
      ? parseQualifiedModel(s.model, { claudePrefix: true })?.alias
      : undefined;
    return alias !== undefined && !aliases.has(alias);
  };
  const target = scheduled
    ? [harnessName(scheduled.harness), scheduled.model ?? "model not set"].join(
        " · ",
      )
    : "the scheduled default";
  const moveAll = () =>
    void showConfirm(
      <div className="flex flex-col gap-2">
        <p>These schedules drop their own choices and run on {target}:</p>
        <ul className="list-disc pl-5">
          {rows.map((s) => (
            <li key={s.id}>
              <strong>{s.name}</strong>: {describe(s)}
            </li>
          ))}
        </ul>
      </div>,
      "Move all schedules to the scheduled default?",
      { confirmLabel: "Move all" },
    ).then((ok) => ok && clear.mutate({ ids: rows.map((s) => s.id) }));

  return (
    <div data-testid="off-default-schedules" className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">
          Not on the scheduled default
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={clear.isPending}
          onClick={moveAll}
        >
          Move all to default
        </Button>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {rows.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <button
                type="button"
                className="truncate font-medium text-foreground hover:underline"
                onClick={() => navigateToSandboxHome(agentId, "schedules")}
              >
                {s.name}
              </button>
              <p className="truncate text-muted-foreground">
                {failing(s) && (
                  <span className="mr-1.5 text-warning">Provider gone ·</span>
                )}
                {describe(s)}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={clear.isPending}
              onClick={() => clear.mutate({ ids: [s.id] })}
            >
              Use default
            </Button>
          </li>
        ))}
      </ul>
      {clear.data && clear.data.failed.length > 0 && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          Couldn&rsquo;t move:{" "}
          {clear.data.failed
            .map(
              (f) =>
                `${schedules.find((s) => s.id === f.id)?.name ?? f.id} (${f.reason})`,
            )
            .join(", ")}
        </p>
      )}
    </div>
  );
}
