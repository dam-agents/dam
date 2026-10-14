import type { InfraAgent } from "../../agents/infrastructure/agent-mappers.js";
import {
  type AlertKind,
  type AlertMark,
  type AlertStep,
  nextOom,
  nextStorage,
  STORAGE_WRITES_FAILING_PERCENT,
} from "../domain/alert-policy.js";
import type { ResourceAlertsRepository } from "../infrastructure/resource-alerts-repository.js";

export const RUNNER_OOM_REASON = "RunnerOutOfMemory";
const OOM_COLLECT_MS = 15_000;
const STORAGE_READ_LANES = 10;
const GIB = 1024 ** 3;

export interface OwnerStorage {
  usedBytes: number;
  usableBytes: number;
}

export interface ResourceAlertsService {
  evaluateStorage(): Promise<void>;
  agentChanged(agent: InfraAgent): void;
  stop(): void;
}

export function createResourceAlertsService(deps: {
  repo: ResourceAlertsRepository;
  notify: (ownerSub: string, text: string) => Promise<{ sent: number }>;
  listStorageOwners: () => Promise<string[]>;
  readStorage: (ownerSub: string) => Promise<OwnerStorage | null>;
  listOwnerAgents: (ownerSub: string) => Promise<InfraAgent[]>;
  homeUrl: string;
  log: (message: string) => void;
  now?: () => Date;
  collectMs?: number;
}): ResourceAlertsService {
  const now = deps.now ?? (() => new Date());
  const collectMs = deps.collectMs ?? OOM_COLLECT_MS;
  const pendingOom = new Map<string, ReturnType<typeof setTimeout>>();
  const openOom = new Set<string>();

  async function advance(
    ownerSub: string,
    kind: AlertKind,
    step: (prev: AlertMark) => AlertStep,
    message: () => string,
  ): Promise<AlertMark> {
    const stored = await deps.repo.read(ownerSub, kind);
    const { mark, send } = step(stored.mark);
    if (!send && sameMark(mark, stored.mark)) return mark;
    if (!(await deps.repo.claim(ownerSub, kind, stored.version, mark)))
      return stored.mark;
    if (send) {
      const { sent } = await deps.notify(ownerSub, message());
      if (sent === 0)
        deps.log(`no Slack identity reached ${ownerSub} for a ${kind} alert`);
    }
    return mark;
  }

  async function evaluateOom(ownerSub: string): Promise<void> {
    const affected = (await deps.listOwnerAgents(ownerSub)).filter(
      (a) => a.agentPodNotReadyReason === RUNNER_OOM_REASON,
    );
    const at = now();
    const mark = await advance(
      ownerSub,
      "runner_oom",
      (prev) => nextOom(prev, affected.length, at),
      () =>
        oomMessage(
          affected.map((a) => a.name),
          deps.homeUrl,
        ),
    );
    if (mark.level === "open") openOom.add(ownerSub);
    else openOom.delete(ownerSub);
  }

  function scheduleOom(ownerSub: string): void {
    if (pendingOom.has(ownerSub)) return;
    pendingOom.set(
      ownerSub,
      setTimeout(() => {
        pendingOom.delete(ownerSub);
        evaluateOom(ownerSub).catch((err: unknown) =>
          deps.log(`runner OOM alert for ${ownerSub} failed: ${String(err)}`),
        );
      }, collectMs),
    );
  }

  return {
    async evaluateStorage() {
      const owners = (await deps.listStorageOwners()).values();
      const lane = async () => {
        for (const ownerSub of owners) {
          try {
            const usage = await deps.readStorage(ownerSub);
            if (!usage || usage.usableBytes <= 0) continue;
            const percent = (usage.usedBytes / usage.usableBytes) * 100;
            const at = now();
            await advance(
              ownerSub,
              "storage",
              (prev) => nextStorage(prev, percent, at),
              () => storageMessage(usage, percent, deps.homeUrl),
            );
          } catch (err) {
            deps.log(`storage alert for ${ownerSub} failed: ${String(err)}`);
          }
        }
      };
      await Promise.all(Array.from({ length: STORAGE_READ_LANES }, lane));
      for (const ownerSub of await deps.repo.listOwners("runner_oom", "open"))
        await evaluateOom(ownerSub);
    },

    agentChanged(agent) {
      if (!agent.owner) return;
      if (
        agent.agentPodNotReadyReason === RUNNER_OOM_REASON ||
        openOom.has(agent.owner)
      )
        scheduleOom(agent.owner);
    },

    stop() {
      for (const timer of pendingOom.values()) clearTimeout(timer);
      pendingOom.clear();
    },
  };
}

function sameMark(a: AlertMark, b: AlertMark): boolean {
  return (
    a.level === b.level &&
    a.notifiedLevel === b.notifiedLevel &&
    a.notifiedAt?.getTime() === b.notifiedAt?.getTime()
  );
}

function gib(bytes: number): string {
  return (bytes / GIB).toFixed(1);
}

export function storageMessage(
  usage: OwnerStorage,
  percent: number,
  homeUrl: string,
): string {
  const full = percent >= STORAGE_WRITES_FAILING_PERCENT;
  return [
    `Your agents' shared storage is ${Math.floor(percent)}% full (${gib(usage.usedBytes)} of ${gib(usage.usableBytes)} GiB).`,
    full
      ? "Your agents may be failing to write files now, and could lose data."
      : "New agents can't be created, and stopped agents can't start, until you free space.",
    "Delete an agent you no longer need, clear caches inside your agents, or ask an admin for more storage.",
    homeUrl,
  ].join(" ");
}

export function oomMessage(agents: readonly string[], homeUrl: string): string {
  const names = agents.length > 0 ? `: ${agents.join(", ")}` : "";
  return [
    `Your VM agents ran out of memory together, so every one that was running restarted${names}.`,
    "Pause agents you aren't using to free memory, or ask an admin for a larger memory pool.",
    homeUrl,
  ].join(" ");
}
