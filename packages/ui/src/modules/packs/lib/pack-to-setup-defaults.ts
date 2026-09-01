import type { SetupForm } from "../../sandboxes/hooks/use-setup-form.js";
import type { Pack } from "../data/packs.js";

export function packToSetupDefaults(
  pack: Pack,
  userConnectionIds: string[],
  userConnectionTemplateIds: Map<string, string>,
): Partial<SetupForm> {
  const defaults: Partial<SetupForm> = {};

  const harnessSlot = [...pack.included, ...pack.required].find(
    (s) => s.kind === "harness",
  );
  if (harnessSlot?.templateId) {
    defaults.templateId = harnessSlot.templateId;
  }

  const connectionSlots = [...pack.included, ...pack.required].filter(
    (s) => s.kind === "connection" && s.connectionTemplateId,
  );
  const matchedIds: string[] = [];
  for (const slot of connectionSlots) {
    for (const [connId, tplId] of userConnectionTemplateIds) {
      if (
        tplId === slot.connectionTemplateId &&
        userConnectionIds.includes(connId)
      ) {
        matchedIds.push(connId);
        break;
      }
    }
  }
  if (matchedIds.length > 0) {
    defaults.connectionIds = matchedIds;
  }

  const scheduleSlots = [...pack.included, ...pack.required].filter(
    (s) => s.kind === "schedule" && s.demoValue,
  );
  if (scheduleSlots.length > 0) {
    defaults.scheduleDrafts = scheduleSlots.map((s) => ({
      name: s.label,
      task: "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      sessionMode: "fresh" as const,
      kind: "custom" as const,
      interval: "1",
      time: "02:00",
      days: [1, 2, 3, 4, 5],
      customRRule: cronToRRule(s.demoValue ?? ""),
      quietHours: [],
      enabled: true,
    }));
  }

  return defaults;
}

function cronToRRule(cron: string): string {
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return "";
  const [minute, hour] = parts;
  return `RRULE:FREQ=DAILY;BYHOUR=${hour};BYMINUTE=${minute}`;
}
