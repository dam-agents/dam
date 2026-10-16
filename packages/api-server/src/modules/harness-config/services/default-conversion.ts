import { routesByModelName, type HarnessCatalogView } from "agent-runtime-api";
import type { HarnessCatalog, SessionPair } from "api-server-api";
import { harnessFits } from "../../templates/index.js";
import { convertedDefaultModel } from "../domain/default-conversion.js";
import type { FillableSessionPairRepo } from "../infrastructure/session-pair-repo.js";
import type { HarnessConfigSnapshotRepo } from "../infrastructure/snapshot-repo.js";
import { defaultHarnessOf } from "./harness-config-service.js";

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
 * UNIT_BOUNDARY_DESCRIPTION: Upgrade path: remove when no Agent on prod has
 * an empty saved default. An Agent from before per-session defaults has
 * none, and once it runs the Model Router its default is converted once from
 * what is certain about it (its one provider and its harness's model
 * setting) against that provider's listing on the Agent's own runtime. The
 * result is saved even when it names no model, as "not set", so the owner is
 * told and nothing converts it again. An Agent still on an older runtime, or
 * whose provider has not listed, or is unsupported only because an older
 * runtime's env names no template for it, is left for a later try. A fire wakes an
 * Agent first only while it is moved to a new image and not yet started
 * there, so the conversion can run before the fire: that start ends the
 * move, so it happens at most once per move.
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
  modelsRanBy?: (agentId: string, hours: number) => Promise<string[]>;
  movedToNewImage?: (agentId: string) => Promise<boolean>;
  isRunning?: (agentId: string) => Promise<boolean>;
  wake?: (agentId: string) => Promise<WakeStamp | null>;
  lastHelloAt?: (agentId: string) => Promise<number | null>;
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
      const ran = (await deps.modelsRanBy?.(agentId, hours)) ?? [];
      if (ran.length > 0) return ran;
    }
    return [];
  };

  const save = async (
    agentId: string,
    pair: SessionPair,
  ): Promise<DefaultConversion> => {
    if (!(await deps.pairRepo.writeIfEmpty(agentId, pair))) return "saved";
    deps.log(
      `[default-conversion] ${agentId}: ${pair.model === null ? "default not set" : `default set to ${pair.model}`} on ${pair.harness}`,
    );
    return pair.model === null ? "not-set" : "converted";
  };

  const convert = async (agentId: string): Promise<DefaultConversion> => {
    if (await deps.pairRepo.read(agentId)) return "saved";
    const capabilities = await deps.getCapabilities(agentId);
    if (!routesByModelName(capabilities)) return "old-runtime";
    const harness =
      defaultHarnessOf(capabilities) ??
      (await deps.specHarness(agentId)) ??
      deps.catalog.default;
    const fitting = (await deps.pairRepo.grantedProviders(agentId)).filter(
      (p) => harnessFits(deps.catalog, harness, p.type, p.templateId),
    );
    const [provider] = fitting;
    if (fitting.length !== 1 || !provider)
      return save(agentId, { harness, provider: null, model: null });
    const view = await deps.catalogView(agentId, harness).catch(() => null);
    const group = view?.providers.find((p) => p.connectionId === provider.id);
    if (
      !group ||
      group.status === "unavailable" ||
      (group.status === "unsupported" && group.template === "")
    )
      return "waiting";
    const setting =
      (await deps.snapshotRepo.read(agentId, harness))?.model ??
      (await deps.snapshotRepo.read(agentId))?.model ??
      null;
    const needsRan =
      !setting?.trim() || setting.trim().toLowerCase() === "default";
    const model = convertedDefaultModel({
      setting,
      alias: group.alias,
      listed:
        group.status === "listed" ? group.models.map((m) => m.upstreamId) : [],
      ran: needsRan ? await modelsRan(agentId) : [],
    });
    return save(agentId, { harness, provider: provider.id, model });
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

  const helloSince = async (agentId: string, since: number) => {
    const deadline = now() + HELLO_WAIT_MS;
    while (now() < deadline) {
      if (((await deps.lastHelloAt?.(agentId)) ?? 0) >= since) return;
      await sleep(POLL_MS);
    }
  };

  const pendingAfterMove = async (agentId: string): Promise<boolean> =>
    !(await deps.pairRepo.read(agentId)) &&
    ((await deps.movedToNewImage?.(agentId)) ?? false);

  return {
    convert,
    ensure,
    pendingAfterMove,
    async ensureForFire(agentId) {
      if (!(await pendingAfterMove(agentId))) return null;
      let stamp: WakeStamp | null = null;
      if (!((await deps.isRunning?.(agentId)) ?? true)) {
        const since = now();
        stamp = (await deps.wake?.(agentId)) ?? null;
        await helloSince(agentId, since);
      }
      await ensure(agentId, LISTING_WAIT_MS);
      return stamp;
    },
  };
}
