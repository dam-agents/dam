import { randomBytes } from "node:crypto";

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
import type {
  AcpRuntime,
  AcpRuntimeStatus,
} from "./acp-runtime/acp-runtime.js";
import type { AgentRequestObserver } from "./acp-runtime/pending-agent-requests.js";
import {
  CONFIGURE_SESSION_METHOD,
  isPlatformSubagentSetting,
  PIN_MODEL_METHOD,
  sessionSettingsSchema,
  type SessionSettings,
} from "agent-runtime-api";
import { parseQualifiedModel } from "api-server-api";
import type { EnvChange } from "../../runtime-channel/drivers/env-plugin.js";
import type { KeepPolicy } from "../../processes/index.js";

export interface LeasePair {
  harness: string;
  settings?: SessionSettings;
  native?: string;
}

export interface SessionChoice {
  harness: string;
  model: string | null;
  settings?: SessionSettings;
  revoked?: string;
}

export const PROVIDER_REMOVED_REASON = "provider-removed";

export interface LeaseRouterStatus extends AcpRuntimeStatus {
  keptProcesses: number;
}

export interface LeaseRouterDeps {
  defaultHarness: string;
  harnessKnown: (harness: string) => boolean;
  providerAliases: () => string[];
  aliasOfConnection: (connectionId: string) => string | null;
  nativeConnectionOf?: (harness: string, model: string | null) => string | null;
  settingScope?: (harness: string, id: string) => "process" | "session" | null;
  settingsError?: (
    harness: string,
    settings: SessionSettings,
    model: string | null,
  ) => string | undefined;
  initializeFor: (harness: string) => Record<string, unknown> | null;
  listSessions: (isRunning: (sessionId: string) => boolean) => unknown;
  sessionMetadata: SessionMetadataStore;
  backgroundWork: BackgroundWorkRegistry;
  keepPolicy: Pick<KeepPolicy, "keptProcessCount">;
  agentRequests?: AgentRequestObserver;
  createRuntime: (
    pair: LeasePair,
    scoped: {
      pair: () => LeasePair;
      backgroundWork: BackgroundWorkRegistry;
      onHarnessExited: () => void;
      harnessSpawned: () => void;
      agentRequests?: AgentRequestObserver;
    },
  ) => AcpRuntime;
  idleCheckMs?: number;
  leaseIdleMs?: number;
  log: (msg: string) => void;
}

export interface LeaseRouter extends AcpRuntime {
  status(): LeaseRouterStatus;
  applyEnvChange(change: EnvChange): void;
  recycleHarness(harness: string): void;
  leases(): LeasePair[];
  sessionChoice(sessionId: string): SessionChoice;
}

interface Lease {
  key: string;
  process: number;
  pair: LeasePair;
  runtime: AcpRuntime;
  channels: Map<ClientChannel, VirtualChannel>;
  idleSince: number | null;
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
}

const DEFAULT_IDLE_CHECK_MS = 30_000;
const DEFAULT_LEASE_IDLE_MS = 10 * 60_000;
const SWALLOWED_ID_PREFIX = "platform-lease-";
const ROUTED_ID = /^platform-lease-in-([0-9a-f]+)-(\d+)-(.+)$/s;

const keyOf = (pair: LeasePair): string =>
  JSON.stringify([
    pair.harness,
    ...(pair.settings && Object.keys(pair.settings).length > 0
      ? [Object.entries(pair.settings).sort()]
      : []),
    ...(pair.native ? [{ native: pair.native }] : []),
  ]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: Claude Code's picker sends names under its
 * `claude/` prefix and lowercased, and the api-server sends them bare of it;
 * both mean the same catalog entry. A bare name stays as it is.
 */
export function canonicalModel(model: string): string {
  const parsed = parseQualifiedModel(model, { claudePrefix: true });
  return parsed ? `${parsed.alias}/${parsed.upstreamId}` : model;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: holds one harness process per (harness,
 * process-scoped session settings); the model is a per-turn choice the Model
 * Router routes on, not a fact of a process. There is no default lease: a
 * process starts on the first frame naming a session on its harness and goes
 * away once idle, so frames naming no session (`initialize`, `session/list`)
 * are answered here from the manifest and the session metadata. Each lease
 * is an unchanged ACP runtime behind a virtual channel per real client, with
 * agent-request ids kept apart across leases: a client sees each request
 * under an id that names this boot and the harness process that asked it, so
 * an id kept from before a restart reaches no process. An answer under
 * that id reaches that process from any connection, because the platform
 * answers a request from its own record, on a connection of its own; a
 * request no client can answer is reported to the platform under that id.
 */
export function createLeaseRouter(deps: LeaseRouterDeps): LeaseRouter {
  const leases = new Map<string, Lease>();
  const attachments = new Map<ClientChannel, Attachment>();
  const movedSessions = new Set<string>();
  const pendingRestartListeners: (() => void)[] = [];
  const leaseIdleMs = deps.leaseIdleMs ?? DEFAULT_LEASE_IDLE_MS;
  const boot = randomBytes(6).toString("hex");
  let nextProcess = 1;
  let nextSwallowed = 1;

  function ownsSession(lease: Lease, sessionId: string): boolean {
    return keyOf(leasePairOf(sessionChoice(sessionId, false))) === lease.key;
  }

  function scopedBackgroundWork(lease: () => Lease): BackgroundWorkRegistry {
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
      forget: (sid) => shared.forget(sid),
      clear: () => {
        for (const sid of owned()) shared.forget(sid);
      },
      onChange: (cb) => shared.onChange(cb),
    };
  }

  function leaseFor(pair: LeasePair): Lease {
    const key = keyOf(pair);
    const existing = leases.get(key);
    if (existing) return existing;
    let self: Lease | null = null;
    const runtime = deps.createRuntime(pair, {
      pair: () => lease.pair,
      backgroundWork: scopedBackgroundWork(() => self!),
      onHarnessExited: () => {
        deps.log(
          `lease ${lease.key} lost its harness; the next session respawns it`,
        );
        drop(lease);
      },
      harnessSpawned: () => {
        lease.process = nextProcess++;
      },
      ...(deps.agentRequests && {
        agentRequests: unwatchedRequestsOf(() => self!, deps.agentRequests),
      }),
    });
    const lease: Lease = {
      key,
      process: nextProcess++,
      pair,
      runtime,
      channels: new Map(),
      idleSince: null,
    };
    self = lease;
    leases.set(key, lease);
    runtime.onPendingRestartChange(notifyPendingRestart);
    deps.log(`opened lease ${key}`);
    return lease;
  }

  function unwatchedRequestsOf(
    lease: () => Lease,
    report: AgentRequestObserver,
  ): AgentRequestObserver {
    const routed = new Map<unknown, string>();
    const settled = (id: unknown): string | undefined => {
      const clientId = routed.get(id);
      routed.delete(id);
      return clientId;
    };
    return {
      waiting(id, sessionId, line) {
        const clientId = routedId(lease(), id);
        routed.set(id, clientId);
        report.waiting(clientId, sessionId, line);
      },
      answered(id, sessionId, result) {
        const clientId = settled(id);
        if (clientId !== undefined)
          report.answered(clientId, sessionId, result);
      },
      abandoned(id, sessionId) {
        const clientId = settled(id);
        if (clientId !== undefined) report.abandoned(clientId, sessionId);
      },
    };
  }

  function routedId(lease: Lease, id: unknown): string {
    return `${SWALLOWED_ID_PREFIX}in-${boot}-${String(lease.process)}-${JSON.stringify(id)}`;
  }

  function askedBy(
    clientId: string,
  ): { lease: Lease; id: unknown } | "unknown" | null {
    const match = ROUTED_ID.exec(clientId);
    if (!match) return null;
    if (match[1] !== boot) return "unknown";
    const lease = [...leases.values()].find(
      (l) => String(l.process) === match[2],
    );
    if (!lease) return "unknown";
    try {
      return { lease, id: JSON.parse(match[3]!) };
    } catch {
      return "unknown";
    }
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
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a session written before models were
   * qualified carries a bare model and a provider Connection id, so that
   * Connection's alias qualifies the model. With `freeze` the qualified
   * model and harness are written back, so the session never moves again.
   */
  function sessionChoice(sessionId: string, freeze: boolean): SessionChoice {
    const entry = deps.sessionMetadata.get(sessionId);
    const meta = entry?.meta;
    const harness = meta?.harness ?? deps.defaultHarness;
    let model: string | null = meta?.model ?? null;
    let revoked: string | undefined;
    if (model !== null && !parseQualifiedModel(model)) {
      const canonical = canonicalModel(model);
      if (canonical !== model) model = canonical;
    }
    if (
      meta?.provider !== undefined &&
      (model === null || !parseQualifiedModel(model))
    ) {
      const alias = deps.aliasOfConnection(meta.provider);
      if (alias === null) revoked = meta.provider;
      else if (model !== null) model = `${alias}/${model}`;
    }
    if (
      freeze &&
      entry &&
      (meta?.harness !== harness || (model !== null && meta?.model !== model))
    ) {
      deps.sessionMetadata.set(sessionId, {
        ...meta,
        harness,
        ...(model !== null && { model }),
      });
    }
    return {
      harness,
      model,
      ...(meta?.settings && { settings: meta.settings }),
      ...(revoked !== undefined && { revoked }),
    };
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a Connection the harness runs natively is
   * part of the lease key, since such a process gets the Connection's env
   * and not the router.
   */
  function leasePairOf(choice: SessionChoice): LeasePair {
    const own = Object.entries(choice.settings ?? {}).filter(
      ([id]) => deps.settingScope?.(choice.harness, id) === "process",
    );
    const native = deps.nativeConnectionOf?.(choice.harness, choice.model);
    return {
      harness: choice.harness,
      ...(own.length > 0 && { settings: Object.fromEntries(own) }),
      ...(native && { native }),
    };
  }

  function revokedAlias(model: string | null): string | null {
    const alias = model ? parseQualifiedModel(model)?.alias : undefined;
    return alias && !deps.providerAliases().includes(alias) ? alias : null;
  }

  function virtualChannel(real: ClientChannel, lease: Lease): VirtualChannel {
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
            real.send(
              JSON.stringify({ ...frame, id: routedId(lease, frame.id) }),
            );
            return;
          }
        }
        real.send(line);
      },
      close(code, reason) {
        if (!open) return;
        open = false;
        if (v.quiet) return;
        if (v.used) {
          real.close(code, reason);
          return;
        }
        if (lease.channels.get(real) === v) lease.channels.delete(real);
        v.fireClose();
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
    const v = virtualChannel(real, lease);
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

  function reply(real: ClientChannel, id: unknown, result: unknown): void {
    if (real.isOpen())
      real.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  function refuse(real: ClientChannel, id: unknown, error: object): void {
    if (real.isOpen()) real.send(JSON.stringify({ jsonrpc: "2.0", id, error }));
  }

  function providerRemoved(provider: string, alias: string | null): object {
    const named = alias === null ? "" : ` (${alias})`;
    return {
      code: -32001,
      message: `This session's model provider${named} was removed from the agent. Attach it again, or start a new session on another provider's model.`,
      data: { platform: { reason: PROVIDER_REMOVED_REASON, provider } },
    };
  }

  function isSessionRunning(sessionId: string): boolean {
    return (
      leaseOfSession(sessionId)?.runtime.isSessionRunning(sessionId) ?? false
    );
  }

  function route(real: ClientChannel, data: string): void {
    const attachment = attachments.get(real);
    if (!attachment) return;
    const frame = parseFrame(data) as
      (JsonRpcFrame & Record<string, unknown>) | null;
    if (!frame) {
      deps.log("dropped an unparsable client frame");
      return;
    }
    if (isResponse(frame) && typeof frame.id === "string") {
      const asked = askedBy(frame.id);
      if (asked === "unknown") return;
      if (asked) {
        channelOn(real, asked.lease).deliver(
          JSON.stringify({ ...frame, id: asked.id }),
        );
        return;
      }
    }
    const method = typeof frame.method === "string" ? frame.method : "";
    const params = isNonNullObject(frame.params) ? frame.params : undefined;

    if (method === "initialize") {
      attachment.initialize = params ?? {};
      if (isRequest(frame))
        reply(real, frame.id, {
          protocolVersion: 1,
          ...(deps.initializeFor(deps.defaultHarness) ?? {
            agentCapabilities: {},
            authMethods: [],
          }),
        });
      return;
    }

    if (method === PIN_MODEL_METHOD && isRequest(frame)) {
      pinModel(real, frame.id, params);
      return;
    }

    if (method === CONFIGURE_SESSION_METHOD && isRequest(frame)) {
      configure(real, frame.id, params);
      return;
    }

    if (method === "session/new") {
      const requested = platformChoice(params);
      if (requested.invalidSettings) {
        refuse(real, frame.id, {
          code: -32602,
          message: SETTINGS_SHAPE_MESSAGE,
        });
        return;
      }
      const choice: SessionChoice = {
        harness: requested.harness ?? deps.defaultHarness,
        model: requested.model ?? null,
        ...(requested.settings && { settings: requested.settings }),
      };
      const invalid =
        choice.settings &&
        deps.settingsError?.(choice.harness, choice.settings, choice.model);
      if (invalid) {
        refuse(real, frame.id, { code: -32602, message: invalid });
        return;
      }
      if (!deps.harnessKnown(choice.harness)) {
        refuse(real, frame.id, {
          code: -32602,
          message: `This agent does not carry the ${choice.harness} harness`,
        });
        return;
      }
      const revoked = revokedAlias(choice.model);
      if (revoked !== null) {
        refuse(real, frame.id, providerRemoved(revoked, revoked));
        return;
      }
      const v = channelOn(real, leaseFor(leasePairOf(choice)));
      v.used = true;
      v.deliver(JSON.stringify(withPlatformChoice(frame, choice)));
      return;
    }

    const sessionId =
      typeof params?.sessionId === "string" && params.sessionId !== ""
        ? params.sessionId
        : null;
    if (sessionId === null) {
      if (method === "session/list" && isRequest(frame)) {
        reply(real, frame.id, deps.listSessions(isSessionRunning));
        return;
      }
      /**
       * UNIT_BOUNDARY_DESCRIPTION: an image's own protocol over the ACP
       * socket (the e2e mock agent's control calls) names no session, and
       * only the default harness's lease can answer it.
       */
      if (!deps.harnessKnown(deps.defaultHarness)) {
        if (isRequest(frame))
          refuse(real, frame.id, {
            code: -32601,
            message: `${method} names no session; no harness process answers it`,
          });
        return;
      }
      const v = channelOn(
        real,
        leaseFor(leasePairOf({ harness: deps.defaultHarness, model: null })),
      );
      v.used = true;
      v.deliver(data);
      return;
    }
    const choice = sessionChoice(sessionId, true);
    if (!deps.harnessKnown(choice.harness)) {
      if (isRequest(frame))
        refuse(real, frame.id, {
          code: -32602,
          message: `This agent does not carry the ${choice.harness} harness this session runs on`,
        });
      return;
    }
    const revoked = revokedAlias(choice.model);
    if (
      (revoked !== null || choice.revoked !== undefined) &&
      isRequest(frame) &&
      (method === "session/prompt" || method.startsWith("session/set_"))
    ) {
      refuse(
        real,
        frame.id,
        revoked !== null
          ? providerRemoved(revoked, revoked)
          : providerRemoved(choice.revoked!, null),
      );
      return;
    }
    const lease = leaseFor(leasePairOf(choice));
    const v = channelOn(real, lease);
    v.used = true;
    if (movedSessions.delete(sessionId))
      lease.runtime.markSessionCold(sessionId);
    v.deliver(
      method === "session/resume" ? JSON.stringify(withoutChoice(frame)) : data,
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
        ? canonicalModel(params.model)
        : null;
    const entry = deps.sessionMetadata.get(sessionId);
    if (!entry) {
      refuse(real, id, { code: -32602, message: "Unknown session" });
      return;
    }
    const revoked = revokedAlias(model);
    if (revoked !== null) {
      refuse(real, id, providerRemoved(revoked, revoked));
      return;
    }
    const choice = sessionChoice(sessionId, true);
    const { model: _previous, settings: previous, ...meta } = entry.meta;
    const settings = Object.fromEntries(
      Object.entries(previous ?? {}).filter(
        ([key, value]) =>
          isPlatformSubagentSetting(key) ||
          !deps.settingsError?.(choice.harness, { [key]: value }, model),
      ),
    );
    const from = leases.get(keyOf(leasePairOf(choice)));
    const moving =
      keyOf(leasePairOf(choice)) !==
      keyOf(leasePairOf({ ...choice, model, settings }));
    if (moving && from?.runtime.isSessionRunning(sessionId)) {
      refuse(real, id, {
        code: -32000,
        message: "This model can be picked once the current turn ends",
      });
      return;
    }
    deps.sessionMetadata.set(sessionId, {
      ...meta,
      ...(model !== null && { model }),
      ...(Object.keys(settings).length > 0 && { settings }),
    });
    if (moving) moveSession(sessionId, from);
    else leaseOfSession(sessionId)?.runtime.syncSessionSettings(sessionId);
    reply(real, id, { model });
  }

  function moveSession(sessionId: string, from: Lease | undefined): void {
    movedSessions.add(sessionId);
    if (
      !from ||
      from.key === keyOf(leasePairOf(sessionChoice(sessionId, false)))
    )
      return;
    from.runtime.releaseSession(sessionId);
  }

  function configure(
    real: ClientChannel,
    id: unknown,
    params: Record<string, unknown> | undefined,
  ): void {
    const sessionId =
      typeof params?.sessionId === "string" ? params.sessionId : "";
    const entry = deps.sessionMetadata.get(sessionId);
    if (!entry) {
      refuse(real, id, { code: -32602, message: "Unknown session" });
      return;
    }
    const changes = isNonNullObject(params?.settings) ? params.settings : {};
    const merged: Record<string, unknown> = { ...entry.meta.settings };
    for (const [key, value] of Object.entries(changes))
      if (isUnset(value)) delete merged[key];
      else merged[key] = value;
    const parsed = sessionSettingsSchema.safeParse(merged);
    const choice = sessionChoice(sessionId, true);
    const invalid = parsed.success
      ? deps.settingsError?.(choice.harness, parsed.data, choice.model)
      : SETTINGS_SHAPE_MESSAGE;
    if (invalid || !parsed.success) {
      refuse(real, id, { code: -32602, message: invalid });
      return;
    }
    const from = leases.get(keyOf(leasePairOf(choice)));
    const moving =
      keyOf(leasePairOf(choice)) !==
      keyOf(leasePairOf({ ...choice, settings: parsed.data }));
    if (moving && from?.runtime.isSessionRunning(sessionId)) {
      refuse(real, id, {
        code: -32000,
        message: "This setting can change once the current turn ends",
      });
      return;
    }
    const { settings: _previous, ...meta } = entry.meta;
    deps.sessionMetadata.set(sessionId, {
      ...meta,
      ...(Object.keys(parsed.data).length > 0 && { settings: parsed.data }),
    });
    if (moving) moveSession(sessionId, from);
    else from?.runtime.syncSessionSettings(sessionId);
    reply(real, id, { settings: parsed.data });
  }

  function idleOut(): void {
    const now = Date.now();
    for (const lease of [...leases.values()]) {
      if (lease.runtime.holdsSessions()) {
        lease.idleSince = null;
        continue;
      }
      lease.idleSince ??= now;
      if (now - lease.idleSince < leaseIdleMs) continue;
      deps.log(
        `lease ${lease.key} held no session for a while; shutting it down`,
      );
      drop(lease);
      lease.runtime.shutdown("lease");
    }
  }

  const idleTimer = setInterval(
    idleOut,
    deps.idleCheckMs ?? DEFAULT_IDLE_CHECK_MS,
  );
  idleTimer.unref?.();

  function leaseOfSession(sessionId: string): Lease | undefined {
    return leases.get(keyOf(leasePairOf(sessionChoice(sessionId, false))));
  }

  return {
    attach(real, opts) {
      attachments.set(real, {
        viewer: opts?.viewer !== false,
        initialize: undefined,
      });
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

    prestart() {
      leaseFor({ harness: deps.defaultHarness }).runtime.prestart();
    },

    status() {
      const all = [...leases.values()].map((l) => l.runtime.status());
      const keptProcesses = deps.keepPolicy.keptProcessCount();
      return {
        idle: keptProcesses === 0 && all.every((s) => s.idle),
        backgroundWork: deps.backgroundWork.held(),
        keptProcesses,
      };
    },

    isSessionRunning,

    sessionChoice: (sessionId) => sessionChoice(sessionId, false),

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

    syncSessionSettings(sessionId) {
      leaseOfSession(sessionId)?.runtime.syncSessionSettings(sessionId);
    },

    holdsSessions() {
      return [...leases.values()].some((l) => l.runtime.holdsSessions());
    },

    refreshEnv(opts) {
      for (const lease of leases.values()) lease.runtime.refreshEnv(opts);
    },

    applyEnvChange(change) {
      for (const lease of [...leases.values()]) {
        const hits = [
          change.base,
          ...change.providers,
          change.harnesses.find((h) => h.id === lease.pair.harness),
        ].filter((hit) => hit != null);
        if (hits.length === 0) continue;
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
      for (const lease of leases.values()) lease.runtime.shutdown("process");
      leases.clear();
    },
  };
}

const SETTINGS_SHAPE_MESSAGE =
  "Session settings must map setting ids to values";

const isUnset = (value: unknown): boolean => value === "" || value === null;

function withoutUnset(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(settings).filter(([, value]) => !isUnset(value)),
  );
}

function platformChoice(
  params: Record<string, unknown> | undefined,
): Partial<SessionChoice> & { invalidSettings?: true } {
  const meta = isNonNullObject(params?._meta) ? params._meta : undefined;
  const platform = isNonNullObject(meta?.platform) ? meta.platform : undefined;
  const text = (key: string): string | undefined => {
    const v = platform?.[key];
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const harness = text("harness");
  const model = text("model");
  const raw = platform?.settings;
  const settings = isNonNullObject(raw)
    ? sessionSettingsSchema.safeParse(withoutUnset(raw))
    : undefined;
  return {
    ...(harness !== undefined && { harness }),
    ...(model !== undefined && { model: canonicalModel(model) }),
    ...(settings?.success && { settings: settings.data }),
    ...(settings?.success === false && { invalidSettings: true }),
  };
}

function withPlatformChoice(
  frame: Record<string, unknown>,
  choice: SessionChoice,
): object {
  const params = isNonNullObject(frame.params) ? frame.params : {};
  const meta = isNonNullObject(params._meta) ? params._meta : {};
  const platform = isNonNullObject(meta.platform) ? meta.platform : {};
  const { provider: _provider, settings: _settings, ...rest } = platform;
  return {
    ...frame,
    params: {
      ...params,
      _meta: {
        ...meta,
        platform: {
          ...rest,
          harness: choice.harness,
          ...(choice.model !== null && { model: choice.model }),
          ...(choice.settings && { settings: choice.settings }),
        },
      },
    },
  };
}

function withoutChoice(frame: Record<string, unknown>): object {
  const params = isNonNullObject(frame.params) ? frame.params : undefined;
  const meta = isNonNullObject(params?._meta) ? params._meta : undefined;
  if (!params || !meta || !isNonNullObject(meta.platform)) return frame;
  const {
    harness: _h,
    provider: _p,
    model: _m,
    settings: _s,
    ...platform
  } = meta.platform;
  return { ...frame, params: { ...params, _meta: { ...meta, platform } } };
}
