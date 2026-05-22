import type { Contribution, SignalEvent } from "api-server-api";

/** Driver applies a single contribution to the running pod. One driver
 *  per `kind` is registered; the registry picks the driver from the
 *  contribution's discriminator. New kinds added later (custom MCP
 *  variants, agents-specific shapes) plug in via the same registry
 *  without changing the runtime channel core. */
export interface Driver<C extends Contribution = Contribution> {
  /** The discriminator string this driver handles. */
  kind: C["kind"];
  apply(contribution: C, ctx: DriverContext): Promise<void>;
}

export interface DriverContext {
  /** Absolute on-pod HOME directory. Drivers materialize files under
   *  this prefix; writes outside are refused. */
  agentHome: string;
  log: (msg: string) => void;
}

export interface SignalDriver {
  /** Signal action ids this driver handles. A single driver can claim
   *  multiple actions (e.g., one schedule-trigger driver handles
   *  `schedule.cron` and `schedule.rrule`). */
  actions: string[];
  handle(signal: SignalEvent, ctx: DriverContext): Promise<void>;
}

export interface DriverRegistry {
  applyKinds: ReadonlySet<string>;
  signalActions: ReadonlySet<string>;
  /** Looks up the driver for a contribution. Returns undefined when
   *  the kind isn't registered — caller logs and drops. */
  resolveContribution(kind: string): Driver | undefined;
  resolveSignal(action: string): SignalDriver | undefined;
}

export function createDriverRegistry(input: {
  drivers: Driver[];
  signalDrivers: SignalDriver[];
}): DriverRegistry {
  const byKind = new Map<string, Driver>();
  for (const d of input.drivers) byKind.set(d.kind, d);
  const byAction = new Map<string, SignalDriver>();
  for (const d of input.signalDrivers)
    for (const a of d.actions) byAction.set(a, d);

  return {
    applyKinds: new Set(byKind.keys()),
    signalActions: new Set(byAction.keys()),
    resolveContribution: (kind) => byKind.get(kind),
    resolveSignal: (action) => byAction.get(action),
  };
}
