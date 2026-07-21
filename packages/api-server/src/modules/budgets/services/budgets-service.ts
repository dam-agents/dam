import { TRPCError } from "@trpc/server";
import type { BudgetReserved, BudgetsService } from "api-server-api";

/** The slice of an agent the meter needs: its size (limits) and whether it
 *  currently holds it. Structural, so the composition can feed it straight
 *  from the agents repository without this module importing it. */
export interface BudgetedAgent {
  id: string;
  spec: { resources?: { limits?: Record<string, string> } };
  hibernated: boolean;
  overBudget: boolean;
}

/** A live fork acting as the caller, at its parent agent's size (#2843). */
export interface ForkReservation {
  limits?: Record<string, string> | undefined;
}

export interface BudgetsServiceDeps {
  /** The caller's agents (owner scoping happens in the wiring). */
  listAgents(): Promise<BudgetedAgent[]>;
  /** The caller's running forks — they reserve like agents do. Optional so
   *  composers that never surface fork reservations stay unchanged. */
  listForkReservations?(): Promise<ForkReservation[]>;
  /** The caller's UserBudget ceiling, or null for the chart default. */
  readCeilingOverride(): Promise<{ cpu: string; memory: string } | null>;
  /** Chart-default ceiling (same Helm value the controller enforces with). */
  defaultCeiling: { cpu: string; memory: string };
}

/** Courtesy check for resizing an UP agent (#1900): the settings dialog
 *  gets a synchronous FORBIDDEN with the figures instead of a park moments
 *  later. NOT the enforcement — the controller's live-resize render gate is
 *  authoritative and parks any over-ceiling grow that slips past this
 *  (races, out-of-band spec writes). The caller serializes per owner around
 *  check+patch to keep the courtesy accurate under back-to-back saves. */
export interface ResizeGate {
  assertResizeFits(
    agent: BudgetedAgent,
    newSize: { cpu?: string; memory?: string },
  ): Promise<void>;
}

export function createResizeGate(deps: BudgetsServiceDeps): ResizeGate {
  return {
    async assertResizeFits(agent, newSize) {
      const current = agent.spec.resources?.limits;
      const newCpu = parseCpuMilli(newSize.cpu ?? current?.cpu);
      const newMemory = parseMemoryBytes(newSize.memory ?? current?.memory);
      // Shrinking (or holding) is always allowed — even for an owner already
      // over their ceiling (grandfathered overshoot), a decrease only helps.
      if (
        newCpu <= parseCpuMilli(current?.cpu) &&
        newMemory <= parseMemoryBytes(current?.memory)
      ) {
        return;
      }
      const [agents, override] = await Promise.all([
        deps.listAgents(),
        deps.readCeilingOverride(),
      ]);
      const ceiling = override ?? deps.defaultCeiling;
      let cpuMilli = 0;
      let memoryBytes = 0;
      for (const a of agents) {
        if (a.id === agent.id || a.hibernated || a.overBudget) continue;
        cpuMilli += parseCpuMilli(a.spec.resources?.limits?.cpu);
        memoryBytes += parseMemoryBytes(a.spec.resources?.limits?.memory);
      }
      const totalCpu = cpuMilli + newCpu;
      const totalMemory = memoryBytes + newMemory;
      const ceilCpu = parseCpuMilli(ceiling.cpu);
      const ceilMemory = parseMemoryBytes(ceiling.memory);
      if (totalCpu > ceilCpu || totalMemory > ceilMemory) {
        const cores = (n: number) => `${(n / 1000).toFixed(1)} CPU`;
        const gi = (n: number) => `${(n / 1024 ** 3).toFixed(1)}Gi`;
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            `This size would take your running sandboxes to ${cores(totalCpu)}/${cores(ceilCpu)} ` +
            `and ${gi(totalMemory)}/${gi(ceilMemory)} memory — pause, stop, or shrink another sandbox first.`,
        });
      }
    },
  };
}

/** Reserved-vs-Ceiling for the meter (#1900). Display-only: enforcement is
 *  the controller's, computed from the same specs — a misparse here renders
 *  a wrong meter, never a wrong enforcement decision. */
export function createBudgetsService(deps: BudgetsServiceDeps): BudgetsService {
  return {
    async reserved(): Promise<BudgetReserved> {
      const [agents, forkReservations, override] = await Promise.all([
        deps.listAgents(),
        deps.listForkReservations?.() ?? Promise.resolve([]),
        deps.readCeilingOverride(),
      ]);
      let cpuMilli = 0;
      let memoryBytes = 0;
      for (const a of agents) {
        // "Up" mirrors the controller's counting as closely as the CR view
        // allows: hibernated and parked agents reserve nothing. Limits are
        // the budgeted quantity — the agent's size.
        if (a.hibernated || a.overBudget) continue;
        cpuMilli += parseCpuMilli(a.spec.resources?.limits?.cpu);
        memoryBytes += parseMemoryBytes(a.spec.resources?.limits?.memory);
      }
      // Forks acting as the caller reserve at their parent's size while
      // their pods run (#2843) — the controller counts them, so the meter
      // must too or it shows room the next start won't get.
      for (const f of forkReservations) {
        cpuMilli += parseCpuMilli(f.limits?.cpu);
        memoryBytes += parseMemoryBytes(f.limits?.memory);
      }
      const ceiling = override ?? deps.defaultCeiling;
      return {
        cpu: {
          reservedMilli: cpuMilli,
          ceilingMilli: parseCpuMilli(ceiling.cpu),
        },
        memory: {
          reservedBytes: memoryBytes,
          ceilingBytes: parseMemoryBytes(ceiling.memory),
        },
      };
    },
  };
}

// Quantity parsing over api-server-stamped specs and admission-validated
// ceilings only — every input was validated at write time (slider schema,
// template load, CRD admission), so exotic forms don't reach here. Feeds the
// meter and the resize gate; the controller's 0→1 gate never consumes these.

function parseCpuMilli(q: string | undefined): number {
  if (!q) return 0;
  const s = q.trim();
  const n = s.endsWith("m") ? Number(s.slice(0, -1)) : Number(s) * 1000;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

const MEM_UNITS: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

function parseMemoryBytes(q: string | undefined): number {
  if (!q) return 0;
  const m = q.trim().match(/^(\d+(?:\.\d+)?)([A-Za-z]+)?$/);
  if (!m) return 0;
  const factor = m[2] ? (MEM_UNITS[m[2]] ?? 0) : 1;
  return Math.round(Number(m[1]) * factor);
}
