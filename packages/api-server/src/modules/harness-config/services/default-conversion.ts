import { routesByModelName, type HarnessCatalogView } from "agent-runtime-api";
import {
  parseQualifiedModel,
  type HarnessCatalog,
  type SessionPair,
} from "api-server-api";
import { harnessFits } from "../../templates/index.js";
import { convertedDefault } from "../domain/converted-default.js";
import type { DefaultModelNote } from "../domain/default-model-notice.js";
import type { FillableSessionPairRepo } from "../infrastructure/session-pair-repo.js";
import type { HarnessConfigSnapshotRepo } from "../infrastructure/snapshot-repo.js";
import { defaultHarnessOf } from "./harness-config-service.js";
import { NoDefaultModelError } from "../domain/no-default-model.js";

export type DefaultConversion =
  "saved" | "converted" | "not-set" | "old-runtime" | "waiting";

export interface WakeStamp {
  previous: string | null;
  written: string;
}

export interface DefaultConverter {
  convert(agentId: string): Promise<DefaultConversion>;
  ensure(agentId: string, timeoutMs: number): Promise<DefaultConversion>;
  pendingAfterMove(agentId: string): Promise<boolean>;
  ensureForFire(agentId: string): Promise<WakeStamp | null>;
}

const RAN_WINDOWS_HOURS = [24, 7 * 24, 30 * 24];
const POLL_MS = 2_000;
const HELLO_WAIT_MS = 180_000;
const LISTING_WAIT_MS = 120_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: An Agent from before per-session defaults has
 * no saved default, and neither has a new Agent until its runtime first says
 * hello. Once it runs the Model Router its default is converted once, and
 * only while nothing is saved, so a model the person picked is never rewritten:
 * from what is certain about it (the model its calls ran, and its harness's
 * model setting) against its providers' listings on the Agent's own runtime,
 * and then from the platform's model preference list, which also decides an
 * Agent whose providers number more than one — the case that used to be left
 * "not set" because no provider's own order could be trusted over another's.
 * The result is a normal default the owner sees and can change, or "not set",
 * which is saved too, so the owner is told and nothing converts it again. An
 * Agent still on an older runtime, or whose providers have not listed, or are
 * unsupported only because an older runtime's env names no template for them,
 * is left for a later try. A fire
 * wakes an Agent first only while it is moved to a new image and asleep, so
 * the fire is checked and resolved against the new runtime, not the one its
 * last hello came from; that start ends the move. When the new runtime does
 * not say hello in time, the fire fails as still setting up rather than go
 * out with the old runtime's view.
 */
export function createDefaultConverter(deps: {
  pairRepo: FillableSessionPairRepo;
  snapshotRepo: HarnessConfigSnapshotRepo;
  catalog: HarnessCatalog;
  getCapabilities: (agentId: string) => Promise<unknown>;
  specHarness: (agentId: string) => Promise<string | undefined>;
  catalogView: (
    agentId: string,
    harness: string,
  ) => Promise<HarnessCatalogView | null>;
  modelsRanBy: (agentId: string, hours: number) => Promise<string[]>;
  kitDefaultModel: (agentId: string) => Promise<string | null>;
  movedToNewImage: (agentId: string) => Promise<boolean>;
  isRunning: (agentId: string) => Promise<boolean>;
  wake: (agentId: string) => Promise<WakeStamp | null>;
  lastHelloAt: (agentId: string) => Promise<number | null>;
  onSaved: (agentId: string) => void;
  log: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): DefaultConverter {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const inFlight = new Map<string, Promise<DefaultConversion>>();

  const modelsRan = async (agentId: string): Promise<string[]> => {
    for (const hours of RAN_WINDOWS_HOURS) {
      const ran = await deps.modelsRanBy(agentId, hours);
      if (ran.length > 0) return ran;
    }
    return [];
  };

  const save = async (
    agentId: string,
    pair: SessionPair,
    note?: DefaultModelNote,
  ): Promise<DefaultConversion> => {
    if (!(await deps.pairRepo.writeIfEmpty(agentId, pair, note)))
      return "saved";
    deps.log(
      `[default-conversion] ${agentId}: ${pair.model === null ? "default not set" : `default set to ${pair.model}`} on ${pair.harness}${note ? ` (in place of ${note.changedFrom})` : ""}`,
    );
    deps.onSaved(agentId);
    return pair.model === null ? "not-set" : "converted";
  };

  const convert = async (agentId: string): Promise<DefaultConversion> => {
    if (await deps.pairRepo.read(agentId, "chat")) return "saved";
    const capabilities = await deps.getCapabilities(agentId);
    if (!routesByModelName(capabilities)) return "old-runtime";
    const harness =
      defaultHarnessOf(capabilities) ??
      (await deps.specHarness(agentId)) ??
      deps.catalog.default;
    const fitting = (await deps.pairRepo.grantedProviders(agentId)).filter(
      (p) => harnessFits(deps.catalog, harness, p.type, p.templateId),
    );
    if (fitting.length === 0)
      return save(agentId, { harness, provider: null, model: null });
    const view = await deps.catalogView(agentId, harness).catch(() => null);
    const groups = fitting.flatMap((p) => {
      const group = view?.providers.find((g) => g.connectionId === p.id);
      return group &&
        group.status !== "unavailable" &&
        !(group.status === "unsupported" && group.template === "")
        ? [group]
        : [];
    });
    /** UNIT_BOUNDARY_DESCRIPTION: a fitting provider that is late or failing
     * keeps the conversion pending, since deciding without it would save
     * another provider's model for good. */
    if (groups.length < fitting.length) return "waiting";
    const providers = groups.map((g) => ({
      connectionId: g.connectionId,
      alias: g.alias,
      listed: g.status === "listed" ? g.models.map((m) => m.upstreamId) : [],
    }));
    const setting =
      (await deps.snapshotRepo.read(agentId, harness))?.model ??
      (await deps.snapshotRepo.read(agentId))?.model ??
      null;
    const needsRan =
      !setting?.trim() || setting.trim().toLowerCase() === "default";
    const converted = convertedDefault({
      setting,
      providers,
      ran: needsRan ? await modelsRan(agentId) : [],
      declared: await deps.kitDefaultModel(agentId),
    });
    const model = converted?.model ?? null;
    const alias = model ? parseQualifiedModel(model)?.alias : null;
    return save(
      agentId,
      {
        harness,
        provider:
          providers.find((p) => p.alias === alias)?.connectionId ?? null,
        model,
      },
      converted?.changedFrom
        ? { changedFrom: converted.changedFrom }
        : undefined,
    );
  };

  const polled = async (
    agentId: string,
    timeoutMs: number,
  ): Promise<DefaultConversion> => {
    const deadline = now() + timeoutMs;
    for (;;) {
      const outcome = await convert(agentId);
      if (outcome !== "waiting" || now() >= deadline) return outcome;
      await sleep(POLL_MS);
    }
  };

  const ensure = (
    agentId: string,
    timeoutMs: number,
  ): Promise<DefaultConversion> => {
    const running = inFlight.get(agentId);
    if (running) return running;
    const run = polled(agentId, timeoutMs).finally(() =>
      inFlight.delete(agentId),
    );
    inFlight.set(agentId, run);
    return run;
  };

  const helloSince = async (
    agentId: string,
    since: number,
  ): Promise<boolean> => {
    const deadline = now() + HELLO_WAIT_MS;
    while (now() < deadline) {
      if (((await deps.lastHelloAt(agentId)) ?? 0) >= since) return true;
      await sleep(POLL_MS);
    }
    return false;
  };

  return {
    convert,
    ensure,
    async pendingAfterMove(agentId) {
      if (!(await deps.movedToNewImage(agentId))) return false;
      return (
        !(await deps.isRunning(agentId)) ||
        !(await deps.pairRepo.read(agentId, "chat"))
      );
    },
    async ensureForFire(agentId) {
      if (!(await deps.movedToNewImage(agentId))) return null;
      let stamp: WakeStamp | null = null;
      if (!(await deps.isRunning(agentId))) {
        const since = now();
        stamp = await deps.wake(agentId);
        if (!(await helloSince(agentId, since)))
          throw new NoDefaultModelError(undefined, { pending: true });
      }
      if (!(await deps.pairRepo.read(agentId, "chat")))
        await ensure(agentId, LISTING_WAIT_MS);
      return stamp;
    },
  };
}
