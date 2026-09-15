import type { Meter } from "@opentelemetry/api";
import type { EntryPointChoice } from "api-server-api";
import type {
  ConnectionKind,
  ExperimentChanged,
  ScheduleFired,
  SkillChangeAction,
  SkillOrigin,
} from "../../../events.js";
import type {
  ConnectionChangeAction,
  RelayKind,
  UsageOutcome,
  UsageSurface,
} from "../domain/vocabulary.js";

export type ScheduleMode = ScheduleFired["mode"];

export type ExperimentAction = NonNullable<ExperimentChanged["action"]>;

export interface UsageRecorder {
  turn(input: { surface: UsageSurface; template: string }): void;
  actorDay(input: { surface: UsageSurface }): void;
  scheduleFire(input: {
    mode: ScheduleMode;
    outcome: UsageOutcome;
    template: string;
  }): void;
  connectionChange(input: {
    action: ConnectionChangeAction;
    kind: ConnectionKind;
    provider: string;
  }): void;
  fileImport(input: {
    surface: UsageSurface;
    outcome: UsageOutcome;
    bytes: number;
  }): void;
  skillChange(input: { action: SkillChangeAction; origin: SkillOrigin }): void;
  relayAttach(input: { relay: RelayKind; surface: UsageSurface }): void;
  experimentChange(input: { action: ExperimentAction }): void;
  invocationSpawn(): void;
  entryPointChoice(input: { choice: EntryPointChoice }): void;
}

export function createOtelUsageRecorder(meter: Meter): UsageRecorder {
  const turns = meter.createCounter("platform.turn.total", {
    description: "Turns submitted to an agent, by originating surface",
  });
  const actorDays = meter.createCounter("platform.actor.active_day.total", {
    description:
      "Actor-days: one per platform identity first seen on a surface on a UTC day",
  });
  const scheduleFires = meter.createCounter("platform.schedule.fire.total", {
    description:
      "Schedule fires, counting whether the trigger reached the agent rather than whether it ran",
  });
  const connectionChanges = meter.createCounter(
    "platform.connection.change.total",
    { description: "Connections added and removed, by provider" },
  );
  const imports = meter.createCounter("platform.import.total", {
    description: "File imports into an agent workspace",
  });
  const importBytes = meter.createCounter("platform.import.bytes", {
    description: "Bytes carried by successful file imports",
    unit: "By",
  });
  const skillChanges = meter.createCounter("platform.skill.change.total", {
    description: "Skills installed on and uninstalled from agents",
  });
  const relayAttaches = meter.createCounter("platform.relay.attach.total", {
    description: "Attachments to a running agent, by relay",
  });
  const experimentChanges = meter.createCounter(
    "platform.experiment.change.total",
    { description: "Experiment transitions a person drove" },
  );
  const invocationSpawns = meter.createCounter(
    "platform.invocation.spawn.total",
    { description: "Invocation targets spawned by a driving agent" },
  );
  const entryPointChoices = meter.createCounter(
    "platform.entry_point.choice.total",
    { description: "Ways in chosen from the empty home screen" },
  );

  return {
    turn({ surface, template }) {
      turns.add(1, {
        "platform.turn.surface": surface,
        "platform.turn.template": template,
      });
    },
    actorDay({ surface }) {
      actorDays.add(1, { "platform.actor.surface": surface });
    },
    scheduleFire({ mode, outcome, template }) {
      scheduleFires.add(1, {
        "platform.schedule.mode": mode,
        "platform.schedule.outcome": outcome,
        "platform.schedule.template": template,
      });
    },
    connectionChange({ action, kind, provider }) {
      connectionChanges.add(1, {
        "platform.connection.action": action,
        "platform.connection.kind": kind,
        "platform.connection.provider": provider,
      });
    },
    fileImport({ surface, outcome, bytes }) {
      imports.add(1, {
        "platform.import.surface": surface,
        "platform.import.outcome": outcome,
      });
      if (outcome === "success" && bytes > 0)
        importBytes.add(bytes, { "platform.import.surface": surface });
    },
    skillChange({ action, origin }) {
      skillChanges.add(1, {
        "platform.skill.action": action,
        "platform.skill.origin": origin,
      });
    },
    relayAttach({ relay, surface }) {
      relayAttaches.add(1, {
        "platform.relay.kind": relay,
        "platform.relay.surface": surface,
      });
    },
    experimentChange({ action }) {
      experimentChanges.add(1, { "platform.experiment.action": action });
    },
    invocationSpawn() {
      invocationSpawns.add(1);
    },
    entryPointChoice({ choice }) {
      entryPointChoices.add(1, { "platform.entry_point.choice": choice });
    },
  };
}
