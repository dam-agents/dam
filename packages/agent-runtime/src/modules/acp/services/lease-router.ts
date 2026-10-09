import {
  isNonNullObject,
  isRequest,
  isResponse,
  parseFrame,
  type JsonRpcFrame,
} from "../domain/frames.js";
import type { ClientChannel } from "../infrastructure/client-channel.js";
import type { SessionMetadataStore } from "../infrastructure/session-metadata-store.js";
import type { BackgroundWorkRegistry } from "./background-work-registry.js";
import type { AcpRuntime } from "./acp-runtime/acp-runtime.js";
import { PIN_MODEL_METHOD } from "agent-runtime-api";
import type { EnvChange } from "../../runtime-channel/drivers/env-plugin.js";

export interface LeasePair {
  harness: string;
  provider: string | null;
  model: string | null;
}

export const PROVIDER_REMOVED_REASON = "provider-removed";

export interface LeaseRouterDeps {
  defaultHarness: string;
  harnessKnown: (harness: string) => boolean;
  providers: () => string[];
  sessionMetadata: SessionMetadataStore;
  backgroundWork: BackgroundWorkRegistry;
  createRuntime: (
    pair: LeasePair,
    scoped: {
      pair: () => LeasePair;
      backgroundWork: BackgroundWorkRegistry;
      onHarnessExited: () => void;
      harnessSpawned: () => void;
    },
  ) => AcpRuntime;
  idleCheckMs?: number;
  log: (msg: string) => void;
}

export interface LeaseRouter extends AcpRuntime {
  applyEnvChange(change: EnvChange): void;
  recycleHarness(harness: string): void;
  leases(): LeasePair[];
}

interface Lease {
  key: string;
  process: number;
  pair: LeasePair;
  runtime: AcpRuntime;
  channels: Map<ClientChannel, VirtualChannel>;
  releaseListeners: (() => void)[];
}

interface VirtualChannel extends ClientChannel {
  deliver(data: string): void;
  fireClose(): void;
  quiet: boolean;
  used: boolean;
}

interface Attachment {
  viewer: boolean;
  initialize: unknown;
  inbound: Map<string, { lease: Lease; id: unknown }>;
}

const DEFAULT_IDLE_CHECK_MS = 30_000;
const SWALLOWED_ID_PREFIX = "platform-lease-";

const keyOf = (pair: LeasePair): string =>
  JSON.stringify([pair.harness, pair.provider, pair.model]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: Holds one harness process per (harness, provider,
 * model) a session asks for, so a session's model reaches its harness as the
 * process env rather than as a switch inside a live session. Each lease is an
 * unchanged ACP runtime; the router gives every real channel a virtual one per
 * lease it touches, routes each client frame to the lease of the session it
 * names, keeps agent-request ids apart across leases, and replays the
 * channel's own initialize into a lease it reaches late. Pinning a session to
 * another model moves its next turn to that model's lease. A session with no
 * pair, or with a harness but no provider, runs on the default harness and the
 * first granted provider, and keeps that pair once a provider is granted. A
 * lease other than the default one is shut down once it holds no session; one
 * that lost its harness is dropped, one whose provider was removed is shut
 * down, and one that chose its model from an env that changed is reopened. The
 * default lease opened before any provider was granted takes the first one
 * granted and restarts on its env, so a client attached early and the next
 * session meet on the same lease. A lease's going away closes a client
 * connection only when that client used the lease.
 */
export function createLeaseRouter(deps: LeaseRouterDeps): LeaseRouter {
  const leases = new Map<string, Lease>();
  const attachments = new Map<ClientChannel, Attachment>();
  const movedSessions = new Set<string>();
  const pendingRestartListeners: (() => void)[] = [];
  let nextProcess = 1;
  let nextSwallowed = 1;

  const defaultPair = (): LeasePair => ({
    harness: deps.defaultHarness,
    provider: deps.providers()[0] ?? null,
    model: null,
  });

  function ownsSession(lease: Lease, sessionId: string): boolean {
    return keyOf(pairOfSession(sessionId, false)) === lease.key;
  }

  function scopedBackgroundWork(
    lease: () => Lease,
    releaseListeners: (() => void)[],
  ): BackgroundWorkRegistry {
    const shared = deps.backgroundWork;
    const owned = (): string[] =>
      shared
        .reported()
        .map((h) => h.sessionId)
        .filter((sid) => ownsSession(lease(), sid));
    return {
      report: (sid, items) => shared.report(sid, items),
      hasWork: (sid) => shared.hasWork(sid),
      held: () =>
        shared.held().filter((h) => ownsSession(lease(), h.sessionId)),
      reported: () =>
        shared.reported().filter((h) => ownsSession(lease(), h.sessionId)),
      drop: (sid, itemId) => shared.drop(sid, itemId),
      keepChanged: () => shared.keepChanged(),
      forget: (sid) => shared.forget(sid),
      clear: () => {
        for (const sid of owned()) shared.forget(sid);
      },
      onRelease: (cb) => releaseListeners.push(cb),
      onChange: (cb) => shared.onChange(cb),
    };
  }

  function leaseFor(pair: LeasePair): Lease {
    const key = keyOf(pair);
    const existing = leases.get(key);
    if (existing) return existing;
    let self: Lease | null = null;
    const releaseListeners: (() => void)[] = [];
    const runtime = deps.createRuntime(pair, {
      pair: () => lease.pair,
      backgroundWork: scopedBackgroundWork(() => self!, releaseListeners),
      onHarnessExited: () => {
        if (lease.key === keyOf(defaultPair())) return;
        deps.log(
          `lease ${lease.key} lost its harness; the next session respawns it`,
        );
        drop(lease);
      },
      harnessSpawned: () => {
        lease.process = nextProcess++;
      },
    });
    const lease: Lease = {
      key,
      process: nextProcess++,
      pair,
      runtime,
      channels: new Map(),
      releaseListeners,
    };
    self = lease;
    leases.set(key, lease);
    runtime.onPendingRestartChange(notifyPendingRestart);
    deps.log(`opened lease ${key}`);
    return lease;
  }

  function notifyPendingRestart(): void {
    for (const cb of pendingRestartListeners) cb();
  }

  function drop(lease: Lease): void {
    if (leases.get(lease.key) !== lease) return;
    leases.delete(lease.key);
    if (lease.runtime.pendingRestart() !== null) notifyPendingRestart();
    for (const v of lease.channels.values()) v.quiet = true;
    for (const v of lease.channels.values()) v.fireClose();
    lease.channels.clear();
    for (const attachment of attachments.values())
      for (const [id, inbound] of attachment.inbound)
        if (inbound.lease === lease) attachment.inbound.delete(id);
  }

  function pairOfSession(sessionId: string, freeze: boolean): LeasePair {
    const entry = deps.sessionMetadata.get(sessionId);
    const meta = entry?.meta;
    const firstProvider = deps.providers()[0] ?? null;
    if (meta?.harness !== undefined && meta.provider !== undefined) {
      return {
        harness: meta.harness,
        provider: meta.provider,
        model: meta.model ?? null,
      };
    }
    const pair: LeasePair = {
      harness: meta?.harness ?? deps.defaultHarness,
      provider: firstProvider,
      model: meta?.model ?? null,
    };
    if (freeze && entry && firstProvider !== null) {
      deps.sessionMetadata.set(sessionId, {
        ...meta,
        harness: pair.harness,
        provider: firstProvider,
      });
    }
    return pair;
  }

  function virtualChannel(
    real: ClientChannel,
    lease: Lease,
    attachment: Attachment,
  ): VirtualChannel {
    const messageHandlers: ((data: string) => void)[] = [];
    const closeHandlers: (() => void)[] = [];
    let open = true;
    const v: VirtualChannel = {
      quiet: false,
      used: false,
      send(line) {
        if (!real.isOpen()) return;
        if (line.includes(SWALLOWED_ID_PREFIX)) {
          const frame = parseFrame(line);
          if (
            frame &&
            isResponse(frame) &&
            typeof frame.id === "string" &&
            frame.id.startsWith(SWALLOWED_ID_PREFIX)
          )
            return;
        }
        if (line.includes('"method"') && line.includes('"id"')) {
          const frame = parseFrame(line);
          if (frame && isRequest(frame)) {
            const routed = `${SWALLOWED_ID_PREFIX}in-${String(lease.process)}-${JSON.stringify(frame.id)}`;
            attachment.inbound.set(routed, { lease, id: frame.id });
            real.send(JSON.stringify({ ...frame, id: routed }));
            return;
          }
        }
        real.send(line);
      },
      close(code, reason) {
        if (!open) return;
        open = false;
        if (!v.quiet && v.used) real.close(code, reason);
      },
      isOpen: () => open && real.isOpen(),
      onMessage(handler) {
        messageHandlers.push(handler);
      },
      onClose(handler) {
        closeHandlers.push(handler);
      },
      deliver(data) {
        for (const h of messageHandlers) h(data);
      },
      fireClose() {
        open = false;
        for (const h of closeHandlers) h();
      },
    };
    return v;
  }

  function channelOn(real: ClientChannel, lease: Lease): VirtualChannel {
    const existing = lease.channels.get(real);
    if (existing) return existing;
    const attachment = attachments.get(real)!;
    const v = virtualChannel(real, lease, attachment);
    lease.channels.set(real, v);
    lease.runtime.attach(v, { viewer: attachment.viewer });
    if (attachment.initialize !== undefined) {
      v.deliver(
        JSON.stringify({
          jsonrpc: "2.0",
          id: `${SWALLOWED_ID_PREFIX}init-${String(nextSwallowed++)}`,
          method: "initialize",
          params: attachment.initialize,
        }),
      );
    }
    return v;
  }

  function refuse(real: ClientChannel, id: unknown, error: object): void {
    if (real.isOpen()) real.send(JSON.stringify({ jsonrpc: "2.0", id, error }));
  }

  function providerRemoved(provider: string): object {
    return {
      code: -32001,
      message: "This session's model provider was removed from the agent",
      data: { platform: { reason: PROVIDER_REMOVED_REASON, provider } },
    };
  }

  function route(real: ClientChannel, data: string): void {
    const attachment = attachments.get(real);
    if (!attachment) return;
    const frame = parseFrame(data) as
      (JsonRpcFrame & Record<string, unknown>) | null;
    if (!frame) {
      channelOn(real, leaseFor(defaultPair())).deliver(data);
      return;
    }
    if (isResponse(frame) && typeof frame.id === "string") {
      const inbound = attachment.inbound.get(frame.id);
      if (inbound) {
        attachment.inbound.delete(frame.id);
        if (leases.get(inbound.lease.key) !== inbound.lease) return;
        channelOn(real, inbound.lease).deliver(
          JSON.stringify({ ...frame, id: inbound.id }),
        );
        return;
      }
    }
    const method = typeof frame.method === "string" ? frame.method : "";
    const params = isNonNullObject(frame.params) ? frame.params : undefined;
    if (method === "initialize") attachment.initialize = params ?? {};

    if (method === PIN_MODEL_METHOD && isRequest(frame)) {
      pinModel(real, frame.id, params);
      return;
    }

    if (method === "session/new") {
      const requested = platformPair(params);
      const pair = { ...defaultPair(), ...requested };
      if (!deps.harnessKnown(pair.harness)) {
        refuse(real, frame.id, {
          code: -32602,
          message: `This agent does not carry the ${pair.harness} harness`,
        });
        return;
      }
      if (pair.provider !== null && !deps.providers().includes(pair.provider)) {
        refuse(real, frame.id, providerRemoved(pair.provider));
        return;
      }
      const v = channelOn(real, leaseFor(pair));
      v.used = true;
      v.deliver(JSON.stringify(withPlatformPair(frame, pair)));
      return;
    }

    const sessionId =
      typeof params?.sessionId === "string" && params.sessionId !== ""
        ? params.sessionId
        : null;
    if (sessionId === null) {
      channelOn(real, leaseFor(defaultPair())).deliver(data);
      return;
    }
    const pair = pairOfSession(sessionId, true);
    if (!deps.harnessKnown(pair.harness)) {
      if (isRequest(frame))
        refuse(real, frame.id, {
          code: -32602,
          message: `This agent does not carry the ${pair.harness} harness this session runs on`,
        });
      return;
    }
    const revoked =
      pair.provider !== null && !deps.providers().includes(pair.provider);
    if (
      revoked &&
      isRequest(frame) &&
      (method === "session/prompt" || method.startsWith("session/set_"))
    ) {
      refuse(real, frame.id, providerRemoved(pair.provider!));
      return;
    }
    const lease = leaseFor(pair);
    const v = channelOn(real, lease);
    v.used = true;
    if (movedSessions.delete(sessionId))
      lease.runtime.markSessionCold(sessionId);
    v.deliver(
      method === "session/resume" ? JSON.stringify(withoutPair(frame)) : data,
    );
  }

  function pinModel(
    real: ClientChannel,
    id: unknown,
    params: Record<string, unknown> | undefined,
  ): void {
    const sessionId =
      typeof params?.sessionId === "string" ? params.sessionId : "";
    const model =
      typeof params?.model === "string" && params.model !== ""
        ? params.model
        : null;
    const entry = deps.sessionMetadata.get(sessionId);
    if (!entry) {
      refuse(real, id, { code: -32602, message: "Unknown session" });
      return;
    }
    const pair = pairOfSession(sessionId, true);
    if (pair.provider !== null && !deps.providers().includes(pair.provider)) {
      refuse(real, id, providerRemoved(pair.provider));
      return;
    }
    const from = leases.get(keyOf(pair));
    const { model: _previous, ...meta } = entry.meta;
    deps.sessionMetadata.set(sessionId, {
      ...meta,
      ...(model !== null && { model }),
    });
    movedSessions.add(sessionId);
    if (from && from.key !== keyOf(pairOfSession(sessionId, false))) {
      from.runtime.releaseSession(sessionId);
      if (from.key !== keyOf(defaultPair()) && !from.runtime.holdsSessions()) {
        deps.log(
          `lease ${from.key} holds no session after a pin; shutting it down`,
        );
        drop(from);
        from.runtime.shutdown();
      }
    }
    if (real.isOpen())
      real.send(JSON.stringify({ jsonrpc: "2.0", id, result: { model } }));
  }

  function idleOut(): void {
    const defaultKey = keyOf(defaultPair());
    for (const lease of [...leases.values()]) {
      if (lease.key === defaultKey) continue;
      if (lease.runtime.holdsSessions()) continue;
      deps.log(`lease ${lease.key} holds no session; shutting it down`);
      drop(lease);
      lease.runtime.shutdown();
    }
  }

  deps.backgroundWork.onRelease(() => {
    for (const lease of leases.values())
      for (const cb of lease.releaseListeners) cb();
  });

  const idleTimer = setInterval(
    idleOut,
    deps.idleCheckMs ?? DEFAULT_IDLE_CHECK_MS,
  );
  idleTimer.unref?.();

  function seeded(lease: Lease): boolean {
    return lease.key !== keyOf(defaultPair()) && lease.pair.model === null;
  }

  function adoptFirstProvider(): void {
    const pair = defaultPair();
    const key = keyOf(pair);
    if (pair.provider === null || leases.has(key)) return;
    const unprovided = leases.get(keyOf({ ...pair, provider: null }));
    if (!unprovided) return;
    leases.delete(unprovided.key);
    deps.log(`lease ${unprovided.key} takes the first provider: ${key}`);
    unprovided.key = key;
    unprovided.pair = pair;
    leases.set(key, unprovided);
    unprovided.runtime.refreshEnv({ force: true });
  }

  function leaseOfSession(sessionId: string): Lease | undefined {
    return leases.get(keyOf(pairOfSession(sessionId, false)));
  }

  return {
    attach(real, opts) {
      attachments.set(real, {
        viewer: opts?.viewer !== false,
        initialize: undefined,
        inbound: new Map(),
      });
      channelOn(real, leaseFor(defaultPair()));
      real.onMessage((data) => route(real, data));
      real.onClose(() => {
        attachments.delete(real);
        for (const lease of leases.values()) {
          const v = lease.channels.get(real);
          if (!v) continue;
          lease.channels.delete(real);
          v.fireClose();
        }
      });
    },

    status() {
      const all = [...leases.values()].map((l) => l.runtime.status());
      return {
        idle: all.every((s) => s.idle),
        backgroundWork: deps.backgroundWork.held(),
        keptProcesses: all.reduce((n, s) => n + s.keptProcesses, 0),
      };
    },

    isSessionRunning(sessionId) {
      return (
        leaseOfSession(sessionId)?.runtime.isSessionRunning(sessionId) ?? false
      );
    },

    sessionFrames(sessionId) {
      return (
        leaseOfSession(sessionId)?.runtime.sessionFrames(sessionId) ?? {
          frames: [],
          truncated: false,
        }
      );
    },

    resetSession(sessionId) {
      leaseOfSession(sessionId)?.runtime.resetSession(sessionId);
    },

    markSessionCold(sessionId) {
      leaseOfSession(sessionId)?.runtime.markSessionCold(sessionId);
    },

    releaseSession(sessionId) {
      leaseOfSession(sessionId)?.runtime.releaseSession(sessionId);
    },

    holdsSessions() {
      return [...leases.values()].some((l) => l.runtime.holdsSessions());
    },

    refreshEnv(opts) {
      for (const lease of leases.values()) lease.runtime.refreshEnv(opts);
    },

    applyEnvChange(change) {
      adoptFirstProvider();
      for (const lease of [...leases.values()]) {
        if (
          lease.pair.provider !== null &&
          !deps.providers().includes(lease.pair.provider)
        ) {
          deps.log(`lease ${lease.key} lost its provider; shutting it down`);
          const users = [...lease.channels]
            .filter(([, v]) => v.used)
            .map(([real]) => real);
          drop(lease);
          lease.runtime.shutdown();
          for (const real of users)
            if (real.isOpen()) real.close(1012, PROVIDER_REMOVED_REASON);
          continue;
        }
        const hits = [
          change.base,
          change.providers.find((p) => p.id === lease.pair.provider),
          change.harnesses.find((h) => h.id === lease.pair.harness),
        ].filter((hit) => hit != null);
        if (hits.length === 0) continue;
        if (seeded(lease) && lease.runtime.status().idle) {
          deps.log(
            `lease ${lease.key} chose its model from the old env; reopening it`,
          );
          drop(lease);
          lease.runtime.shutdown();
          continue;
        }
        lease.runtime.refreshEnv({
          force: hits.some((hit) => hit.namesChanged),
        });
      }
    },

    recycleForConfig() {
      for (const lease of leases.values()) lease.runtime.recycleForConfig();
    },

    recycleHarness(harness) {
      for (const lease of leases.values())
        if (lease.pair.harness === harness) lease.runtime.recycleForConfig();
    },

    leases() {
      return [...leases.values()].map((l) => l.pair);
    },

    harnesses() {
      return [...leases.values()].flatMap((l) => l.runtime.harnesses());
    },

    pendingRestart() {
      const pending = [...leases.values()]
        .map((l) => l.runtime.pendingRestart())
        .filter((p) => p !== null);
      if (pending.length === 0) return null;
      const oldest = pending.reduce((a, b) => (b.since < a.since ? b : a));
      return {
        ...oldest,
        blockingTasks: pending.reduce((n, p) => n + p.blockingTasks, 0),
        stops: {
          tasks: pending.reduce((n, p) => n + p.stops.tasks, 0),
          turns: pending.reduce((n, p) => n + p.stops.turns, 0),
        },
      };
    },

    applyPendingRestart() {
      let applied = false;
      for (const lease of [...leases.values()])
        if (lease.runtime.applyPendingRestart()) applied = true;
      return applied;
    },

    onPendingRestartChange(cb) {
      pendingRestartListeners.push(cb);
    },

    shutdown() {
      clearInterval(idleTimer);
      for (const lease of leases.values()) lease.runtime.shutdown();
      leases.clear();
    },
  };
}

function platformPair(
  params: Record<string, unknown> | undefined,
): Partial<LeasePair> {
  const meta = isNonNullObject(params?._meta) ? params._meta : undefined;
  const platform = isNonNullObject(meta?.platform) ? meta.platform : undefined;
  const text = (key: string): string | undefined => {
    const v = platform?.[key];
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const harness = text("harness");
  const provider = text("provider");
  const model = text("model");
  return {
    ...(harness !== undefined && { harness }),
    ...(provider !== undefined && { provider }),
    ...(model !== undefined && { model }),
  };
}

function withPlatformPair(
  frame: Record<string, unknown>,
  pair: LeasePair,
): object {
  const params = isNonNullObject(frame.params) ? frame.params : {};
  const meta = isNonNullObject(params._meta) ? params._meta : {};
  const platform = isNonNullObject(meta.platform) ? meta.platform : {};
  return {
    ...frame,
    params: {
      ...params,
      _meta: {
        ...meta,
        platform: {
          ...platform,
          harness: pair.harness,
          ...(pair.provider !== null && { provider: pair.provider }),
          ...(pair.model !== null && { model: pair.model }),
        },
      },
    },
  };
}

function withoutPair(frame: Record<string, unknown>): object {
  const params = isNonNullObject(frame.params) ? frame.params : undefined;
  const meta = isNonNullObject(params?._meta) ? params._meta : undefined;
  if (!params || !meta || !isNonNullObject(meta.platform)) return frame;
  const { harness: _h, provider: _p, model: _m, ...platform } = meta.platform;
  return { ...frame, params: { ...params, _meta: { ...meta, platform } } };
}
