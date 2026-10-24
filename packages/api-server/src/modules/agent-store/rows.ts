import type { controlAgents } from "db";
import type { KubeObject } from "../agents/infrastructure/k8s.js";
import { parseGoDurationNs } from "../../duration.js";
import {
  ACTIVE_SESSION_KEY,
  ANN_AGENT_KIND,
  ANN_IMAGE_UPDATE_FROM,
  ANN_IMAGE_UPDATE_REFUSED,
  ANN_KB_SHARE_ROOTS,
  ANN_KB_TEMPLATE,
  ANN_KIT_UPDATE_PENDING,
  ANN_KIT_UPDATE_SKIPPED,
  ANN_LIFETIME_MS,
  ANN_MACHINE_DOWN,
  ANN_MACHINE_UP,
  ANN_MEMORY_WAIT_UNTIL,
  ANN_ROLL_REV,
  ANN_RUNNER_OOM_KILL,
  ANN_RUNNER_OOM_RECOVERED,
  ANN_STARTER_KIT,
  ANN_STARTER_KIT_DEFAULT_MODEL,
  ANN_STARTER_KIT_ONBOARDED,
  ANN_STARTER_KIT_SEED,
  ANN_SWEEPABLE,
  DISABLED_KEY,
  INVOCATIONS_ACTIVE_KEY,
  LABEL_OWNER,
  LABEL_TEMPLATE_REF,
  LAST_ACTIVITY_KEY,
  RECLAIMED_AT_KEY,
  STOP_REQUESTED_KEY,
} from "../agents/infrastructure/labels.js";

export type AgentRecord = typeof controlAgents.$inferSelect;

export interface SignalRecord {
  agentId: string;
  version: number;
  lastActivityAt: Date | null;
  lastActivityToken: string | null;
  sessionPinned: boolean;
  invocationPinned: boolean;
  invocationPinVersion: number;
  stopRequestToken: string | null;
  stopRequestedAt: Date | null;
  disabledAt: Date | null;
  rollRev: string;
  reclaimedAt: Date | null;
  reclaimedActivityToken: string | null;
  updatedAt: Date;
}

export interface KitRecord {
  agentId: string;
  version: number;
  starterKit: string | null;
  onboardedAt: Date | null;
  seedUrl: string | null;
  seedBranch: string | null;
  seedCommit: string | null;
  defaultModel: string | null;
  pendingCommit: string | null;
  pendingStartedAt: Date | null;
  skippedCommit: string | null;
  updatedAt: Date;
}

export interface StatusRecord {
  agentId: string;
  observedGeneration: number;
  observedSignalVersion: number;
  machineRestarts: number;
  machineRestartReason: string | null;
  machineUpAt: Date | null;
  machineDownAt: Date | null;
  memoryWaitUntil: Date | null;
  runnerOomKillId: string | null;
  runnerOomRecoveredId: string | null;
  version: number;
  updatedAt: Date;
}

export interface ConditionRecord {
  agentId: string;
  type: string;
  status: string;
  reason: string;
  message: string;
  observedGeneration: number;
  lastTransitionAt: Date;
}

export interface AgentRows {
  agent: AgentRecord;
  signals: SignalRecord;
  kit: KitRecord | null;
  status: StatusRecord | null;
  conditions: ConditionRecord[];
  hosts: string[];
  grants: string[];
}

export interface AgentStoreDefaults {
  cpuLimit: string;
  memoryLimit: string;
}

export interface AgentRowMapping {
  id: string;
  rows: AgentRows | undefined;
  dropped: string[];
  normalized: string[];
  refusal?: string;
}

const QUANTITY =
  /^(\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))(([KMGTPE]i)|[numkMGTPE]|([eE](\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))))?$/u;
const COMPARABLE = /^(\d+(?:\.\d+)?)(n|u|m|k|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei)?$/u;
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const L7_HOST =
  /^(\*\.)?([a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?)*$/u;
const L7_HOST_CAP = 256;

const KNOWN_ANNOTATIONS = new Set([
  ACTIVE_SESSION_KEY,
  ANN_AGENT_KIND,
  ANN_IMAGE_UPDATE_FROM,
  ANN_IMAGE_UPDATE_REFUSED,
  ANN_KB_SHARE_ROOTS,
  ANN_KB_TEMPLATE,
  ANN_KIT_UPDATE_PENDING,
  ANN_KIT_UPDATE_SKIPPED,
  ANN_LIFETIME_MS,
  ANN_MACHINE_DOWN,
  ANN_MACHINE_UP,
  ANN_MEMORY_WAIT_UNTIL,
  ANN_ROLL_REV,
  ANN_RUNNER_OOM_KILL,
  ANN_RUNNER_OOM_RECOVERED,
  ANN_STARTER_KIT,
  ANN_STARTER_KIT_DEFAULT_MODEL,
  ANN_STARTER_KIT_ONBOARDED,
  ANN_STARTER_KIT_SEED,
  ANN_SWEEPABLE,
  DISABLED_KEY,
  INVOCATIONS_ACTIVE_KEY,
  LAST_ACTIVITY_KEY,
  RECLAIMED_AT_KEY,
  STOP_REQUESTED_KEY,
]);

const NANO = 10n ** 9n;

const MULTIPLIERS = new Map<string, bigint>([
  ["n", 1n],
  ["u", 10n ** 3n],
  ["m", 10n ** 6n],
  ["", NANO],
  ["k", 10n ** 12n],
  ["M", 10n ** 15n],
  ["G", 10n ** 18n],
  ["T", 10n ** 21n],
  ["P", 10n ** 24n],
  ["E", 10n ** 27n],
  ["Ki", 1024n * NANO],
  ["Mi", 1024n ** 2n * NANO],
  ["Gi", 1024n ** 3n * NANO],
  ["Ti", 1024n ** 4n * NANO],
  ["Pi", 1024n ** 5n * NANO],
  ["Ei", 1024n ** 6n * NANO],
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: the two conversions the mapping needs and the rest
 * of the api-server does not own.
 * A quantity compares on one scale, so a decimal gigabyte is smaller than a
 * binary one; a duration comes back as Go's own text, which is what the readers
 * parse.
 * Only equality and minutes matter to them, and the spelling an operator wrote
 * survives in the archive rather than here.
 */
export const comparables = (quantity: string): bigint | null => {
  const match = COMPARABLE.exec(quantity);
  if (!match?.[1]) return null;
  const multiplier = MULTIPLIERS.get(match[2] ?? "");
  if (multiplier === undefined) return null;
  const [whole = "0", fraction = ""] = match[1].split(".");
  return (
    (BigInt(whole + fraction) * multiplier) / 10n ** BigInt(fraction.length)
  );
};

export function goDuration(ns: number): string {
  if (ns === 0) return "0s";
  const sign = ns < 0 ? "-" : "";
  let left = Math.abs(ns);
  const hours = Math.floor(left / 3_600_000_000_000);
  left -= hours * 3_600_000_000_000;
  const minutes = Math.floor(left / 60_000_000_000);
  left -= minutes * 60_000_000_000;
  const seconds = left / 1_000_000_000;
  const secs = Number.isInteger(seconds)
    ? String(seconds)
    : seconds.toFixed(9).replace(/0+$/u, "");
  return `${sign}${hours === 0 ? "" : `${hours}h`}${hours === 0 && minutes === 0 ? "" : `${minutes}m`}${secs}s`;
}

type Spec = Record<string, unknown>;
type Annotations = Record<string, string>;
type Meta = NonNullable<KubeObject["metadata"]> & {
  creationTimestamp?: string;
  deletionTimestamp?: string;
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const nullable = (value: unknown): string | null => text(value) ?? null;

const parseJson = <T>(raw: string | undefined): T | undefined => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

const mountList = (spec: Spec): Array<Record<string, unknown>> =>
  Array.isArray(spec.mounts)
    ? (spec.mounts as Array<Record<string, unknown>>)
    : [];

const TIME_OF = (value: Date | null): string | undefined =>
  value === null ? undefined : value.toISOString();

const parseTime = (raw: string | undefined): Date | null => {
  if (raw === undefined) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one mapping between an Agent as the rest of the
 * platform sees it and the rows that hold it, in both directions.
 *
 * One module, because the two directions must agree: the dry-run report reads a
 * stored Agent and says what its rows would be, and every Postgres adapter
 * rebuilds the same Agent from those rows, so a field either survives both
 * directions or is named as dropped. The rebuild is deliberately the shape the
 * custom resource had — annotations for the out-of-band signals, a spec for what
 * the controller renders, conditions for what it observed — so the api-server's
 * readers, its tRPC contracts and the UI stay unchanged.
 *
 * An Agent that cannot become a row is refused with its reason rather than
 * repaired, because a repaired Agent would render a different machine than the
 * one running today. What is normalized instead — a negative timeout, duplicate
 * hosts, an uppercase commit — behaves identically afterwards and is counted.
 */
export function rowsFromResource(
  cr: KubeObject,
  defaults: AgentStoreDefaults,
  switchedAt: string,
): AgentRowMapping {
  const metadata = (cr.metadata ?? {}) as Meta;
  const spec = (cr.spec ?? {}) as Spec;
  const annotations = (metadata.annotations ?? {}) as Annotations;
  const dropped: string[] = [];
  const normalized: string[] = [];
  const id = metadata.name ?? "";

  const refuse = (reason: string): AgentRowMapping => ({
    id,
    rows: undefined,
    dropped,
    normalized,
    refusal: reason,
  });

  if (metadata.deletionTimestamp)
    return refuse("the resource is being deleted");
  if (!id || !DNS_LABEL.test(id) || id.length > 63)
    return refuse(
      "the name is not a DNS-1123 label of at most 63 characters, which the platform's labels and machine names are built from",
    );
  const ownerSub = metadata.labels?.[LABEL_OWNER];
  if (!ownerSub) return refuse("the resource carries no owner label");
  const incarnation = metadata.uid;
  if (!incarnation || !UUID.test(incarnation))
    return refuse("the resource has no usable uid to treat as its incarnation");
  const image = text(spec.image);
  if (!image) return refuse("the spec carries no image");

  const limits = (spec.resources ?? {}) as {
    limits?: Record<string, string>;
    requests?: Record<string, string>;
  };
  const cpuLimit = text(limits.limits?.cpu) ?? defaults.cpuLimit;
  const memoryLimit = text(limits.limits?.memory) ?? defaults.memoryLimit;
  if (!QUANTITY.test(cpuLimit))
    return refuse(`${cpuLimit} is not a cpu quantity`);
  if (!QUANTITY.test(memoryLimit))
    return refuse(`${memoryLimit} is not a memory quantity`);

  const storageSize = text(spec.storageSize);
  if (storageSize && !QUANTITY.test(storageSize))
    return refuse(`storageSize ${storageSize} is not a quantity`);
  const mountSizes = mountList(spec)
    .filter((mount) => mount.persist === true)
    .map((mount) => text(mount.size))
    .filter((size): size is string => size !== undefined);
  const badMountSize = mountSizes.find((size) => comparables(size) === null);
  if (badMountSize !== undefined)
    return refuse(
      `a persisted mount's size ${badMountSize} is not a quantity the renderer can size`,
    );
  const mountSize = mountSizes.reduce<string | undefined>((winner, size) => {
    const value = comparables(size);
    const best = winner === undefined ? null : comparables(winner);
    if (value === null) return winner;
    return best === null || value > best ? size : winner;
  }, undefined);
  const storageValue =
    storageSize === undefined ? null : comparables(storageSize);
  const mountValue = mountSize === undefined ? null : comparables(mountSize);
  const diskSize =
    storageValue !== null && (mountValue === null || storageValue >= mountValue)
      ? (storageSize ?? null)
      : (mountSize ?? storageSize ?? null);

  const outsideHome = mountList(spec)
    .filter((mount) => mount.persist === true)
    .map((mount) => text(mount.path))
    .filter((path): path is string => path !== undefined)
    .filter(
      (path) => path !== "/home/agent" && !path.startsWith("/home/agent/"),
    );
  if (outsideHome.length > 0)
    return refuse(
      `a persisted mount outside HOME is refused by the renderer: ${outsideHome.join(", ")}`,
    );

  const timeoutRaw =
    typeof spec.hibernationTimeout === "string"
      ? spec.hibernationTimeout
      : (spec.hibernationTimeout as { duration?: string } | undefined)
          ?.duration;
  const parsedTimeout =
    timeoutRaw === undefined ? null : parseGoDurationNs(timeoutRaw);
  if (timeoutRaw !== undefined && parsedTimeout === null)
    return refuse(`hibernationTimeout ${timeoutRaw} is not a duration`);
  if (parsedTimeout !== null && parsedTimeout < 0n)
    normalized.push("hibernationTimeout.negative");
  const timeoutNs =
    parsedTimeout !== null && parsedTimeout < 0n ? 0n : parsedTimeout;

  const lifetimeRaw = annotations[ANN_LIFETIME_MS];
  const lifetimeMs = lifetimeRaw === undefined ? null : Number(lifetimeRaw);
  if (lifetimeMs !== null && !Number.isFinite(lifetimeMs))
    return refuse("the lifetime annotation is not a number of milliseconds");

  const listedHosts = Array.isArray(spec.l7Hosts)
    ? (spec.l7Hosts as unknown[]).filter(
        (host): host is string => typeof host === "string",
      )
    : [];
  const badHost = listedHosts.find((host) => !L7_HOST.test(host));
  if (badHost !== undefined)
    return refuse(`L7 host ${badHost} is not a hostname`);
  if (listedHosts.length > L7_HOST_CAP)
    return refuse(
      `the spec carries ${listedHosts.length} L7 hosts, over the cap of ${L7_HOST_CAP}`,
    );
  const hosts = [...new Set(listedHosts)];
  if (hosts.length !== listedHosts.length)
    normalized.push("l7Hosts.duplicates");

  if (Array.isArray(spec.env) && (spec.env as unknown[]).length > 0)
    dropped.push("spec.env");
  if (text(spec.init)) dropped.push("spec.init");
  if (text(spec.imagePullPolicy)) dropped.push("spec.imagePullPolicy");
  if (text(spec.storageClass)) dropped.push("spec.storageClass");
  if (text(spec.agentHome)) dropped.push("spec.agentHome");
  if (Object.keys(limits.requests ?? {}).length > 0)
    dropped.push("spec.resources.requests");
  if (
    Array.isArray(spec.grantedSecretIds) &&
    (spec.grantedSecretIds as unknown[]).length > 0
  )
    dropped.push("spec.grantedSecretIds");
  if (
    Object.keys(annotations).some(
      (key) =>
        key.startsWith("agent-platform.ai/") && !KNOWN_ANNOTATIONS.has(key),
    )
  )
    dropped.push("annotations.unknown");
  if (annotations[RECLAIMED_AT_KEY] !== undefined)
    normalized.push("reclaimMark.dropped");

  const seed = parseJson<{ url?: string; branch?: string; commit?: string }>(
    annotations[ANN_STARTER_KIT_SEED],
  );
  const pending = parseJson<{ targetCommit?: string; startedAt?: string }>(
    annotations[ANN_KIT_UPDATE_PENDING],
  );
  const commit = (value: string | undefined): string | null => {
    const lowered = value?.toLowerCase() ?? null;
    if (lowered !== null && lowered !== value)
      normalized.push("kitState.commitCase");
    return lowered;
  };
  const seedComplete =
    nullable(seed?.url) !== null && nullable(seed?.commit) !== null;
  const pendingComplete =
    nullable(pending?.targetCommit) !== null &&
    nullable(pending?.startedAt) !== null;
  if (annotations[ANN_STARTER_KIT_SEED] !== undefined && !seedComplete)
    normalized.push("kitState.droppedSeed");
  if (annotations[ANN_KIT_UPDATE_PENDING] !== undefined && !pendingComplete)
    normalized.push("kitState.droppedPending");
  const kitState: KitRecord = {
    agentId: id,
    version: 0,
    starterKit: nullable(annotations[ANN_STARTER_KIT]),
    onboardedAt: parseTime(annotations[ANN_STARTER_KIT_ONBOARDED]),
    seedUrl: seedComplete ? nullable(seed?.url) : null,
    seedBranch: seedComplete ? nullable(seed?.branch) : null,
    seedCommit: seedComplete ? commit(seed?.commit) : null,
    defaultModel: nullable(annotations[ANN_STARTER_KIT_DEFAULT_MODEL]),
    pendingCommit: pendingComplete ? commit(pending?.targetCommit) : null,
    pendingStartedAt: pendingComplete ? parseTime(pending?.startedAt) : null,
    skippedCommit: commit(annotations[ANN_KIT_UPDATE_SKIPPED]),
    updatedAt: new Date(switchedAt),
  };
  const kitPresent = [
    kitState.starterKit,
    kitState.onboardedAt,
    kitState.seedCommit,
    kitState.defaultModel,
    kitState.pendingCommit,
    kitState.skippedCommit,
  ].some((value) => value !== null);

  const status = cr.status as
    | {
        observedGeneration?: number;
        agentPodRestarts?: number;
        agentPodRestartReason?: string;
        conditions?: Array<Record<string, unknown>>;
      }
    | undefined;
  const conditions: ConditionRecord[] = (status?.conditions ?? []).flatMap(
    (condition) => {
      const type = text(condition.type);
      const state = text(condition.status);
      const transition = text(condition.lastTransitionTime);
      if (!type || !state || !transition) return [];
      return [
        {
          agentId: id,
          type,
          status: state,
          reason: text(condition.reason) ?? "",
          message:
            typeof condition.message === "string" ? condition.message : "",
          observedGeneration: Number(condition.observedGeneration ?? 0),
          lastTransitionAt: new Date(transition),
        },
      ];
    },
  );

  const lastActivityAt = parseTime(annotations[LAST_ACTIVITY_KEY]);
  const flaggedAt = (flag: string | undefined) =>
    flag ? (lastActivityAt ?? new Date(switchedAt)) : null;

  return {
    id,
    dropped,
    normalized,
    rows: {
      agent: {
        id,
        incarnation,
        ownerSub,
        templateId: metadata.labels?.[LABEL_TEMPLATE_REF] ?? null,
        environmentOf: nullable(spec.environmentOf),
        name: text(spec.name) ?? "",
        description: nullable(spec.description),
        avatar: nullable(spec.avatar),
        whispersOff: spec.whispersOff === true,
        image,
        harness: nullable(spec.harness),
        imagePullSecretRef: nullable(spec.imagePullSecretRef),
        secretRef: nullable(spec.secretRef),
        hibernationTimeoutNs: timeoutNs === null ? null : Number(timeoutNs),
        nestedVirtualization: spec.nestedVirtualization === true,
        requireConnectionAddress: spec.requireConnectionAddress === true,
        telemetryAttributionId: nullable(spec.telemetryAttributionId),
        cpuLimit,
        memoryLimit,
        diskSize,
        memoryFallbackBytes: null,
        diskFloorBytes: null,
        unsupportedPersistentPaths: [],
        sweepable: annotations[ANN_SWEEPABLE] === "true",
        lifetimeMs,
        kind: nullable(annotations[ANN_AGENT_KIND]),
        kbTemplateId: nullable(annotations[ANN_KB_TEMPLATE]),
        kbShareRoots: (annotations[ANN_KB_SHARE_ROOTS] ?? "")
          .split(",")
          .map((root) => root.trim())
          .filter((root) => root !== ""),
        imageUpdateFrom: nullable(annotations[ANN_IMAGE_UPDATE_FROM]),
        imageUpdateRefused: nullable(annotations[ANN_IMAGE_UPDATE_REFUSED]),
        generation: Number(metadata.generation ?? 1),
        createdAt:
          parseTime(metadata.creationTimestamp) ?? new Date(switchedAt),
        updatedAt:
          parseTime(metadata.creationTimestamp) ?? new Date(switchedAt),
      },
      signals: {
        agentId: id,
        version: 0,
        lastActivityAt,
        lastActivityToken: null,
        sessionPinned: annotations[ACTIVE_SESSION_KEY] === "true",
        invocationPinned: annotations[INVOCATIONS_ACTIVE_KEY] === "true",
        invocationPinVersion: 0,
        stopRequestToken: null,
        stopRequestedAt: flaggedAt(annotations[STOP_REQUESTED_KEY]),
        disabledAt: flaggedAt(annotations[DISABLED_KEY]),
        rollRev: annotations[ANN_ROLL_REV] ?? "",
        reclaimedAt: null,
        reclaimedActivityToken: null,
        updatedAt: new Date(switchedAt),
      },
      kit: kitPresent ? kitState : null,
      status: {
        agentId: id,
        observedGeneration: Number(status?.observedGeneration ?? 0),
        observedSignalVersion: 0,
        machineRestarts: Number(status?.agentPodRestarts ?? 0),
        machineRestartReason: nullable(status?.agentPodRestartReason),
        machineUpAt: parseTime(annotations[ANN_MACHINE_UP]),
        machineDownAt: parseTime(annotations[ANN_MACHINE_DOWN]),
        memoryWaitUntil: parseTime(annotations[ANN_MEMORY_WAIT_UNTIL]),
        runnerOomKillId: nullable(annotations[ANN_RUNNER_OOM_KILL]),
        runnerOomRecoveredId: nullable(annotations[ANN_RUNNER_OOM_RECOVERED]),
        version: 0,
        updatedAt: new Date(switchedAt),
      },
      conditions,
      hosts: hosts.map((host) => host),
      grants: Array.isArray(spec.grantedConnectionIds)
        ? (spec.grantedConnectionIds as unknown[]).filter(
            (grant): grant is string => typeof grant === "string",
          )
        : [],
    },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the same Agent, rebuilt from its rows in the shape
 * the rest of the api-server already reads — a spec the controller renders, the
 * signals as annotations, the observations as conditions.
 *
 * Nothing here decides anything: a missing kit row means no kit annotations, a
 * missing status row means nothing has been observed yet, and the version it
 * reports is the definition's generation, which is what the custom resource's
 * resourceVersion stood in for at every call site that compares one.
 */
export function resourceFromRows(rows: AgentRows): KubeObject {
  const { agent, signals, kit, status, conditions, hosts, grants } = rows;
  const annotations: Record<string, string> = {};
  const put = (key: string, value: string | undefined) => {
    if (value !== undefined && value !== "") annotations[key] = value;
  };

  put(LAST_ACTIVITY_KEY, TIME_OF(signals.lastActivityAt));
  if (signals.sessionPinned) put(ACTIVE_SESSION_KEY, "true");
  if (signals.invocationPinned) put(INVOCATIONS_ACTIVE_KEY, "true");
  put(STOP_REQUESTED_KEY, TIME_OF(signals.stopRequestedAt));
  put(DISABLED_KEY, TIME_OF(signals.disabledAt));
  put(RECLAIMED_AT_KEY, TIME_OF(signals.reclaimedAt));
  put(ANN_ROLL_REV, signals.rollRev);
  if (agent.sweepable) put(ANN_SWEEPABLE, "true");
  if (agent.lifetimeMs !== null) put(ANN_LIFETIME_MS, String(agent.lifetimeMs));
  put(ANN_AGENT_KIND, agent.kind ?? undefined);
  put(ANN_KB_TEMPLATE, agent.kbTemplateId ?? undefined);
  put(
    ANN_KB_SHARE_ROOTS,
    agent.kbShareRoots === null || agent.kbShareRoots.length === 0
      ? undefined
      : agent.kbShareRoots.join(","),
  );
  put(ANN_IMAGE_UPDATE_FROM, agent.imageUpdateFrom ?? undefined);
  put(ANN_IMAGE_UPDATE_REFUSED, agent.imageUpdateRefused ?? undefined);
  if (kit) {
    put(ANN_STARTER_KIT, kit.starterKit ?? undefined);
    put(ANN_STARTER_KIT_ONBOARDED, TIME_OF(kit.onboardedAt));
    if (kit.seedUrl !== null && kit.seedCommit !== null)
      annotations[ANN_STARTER_KIT_SEED] = JSON.stringify({
        url: kit.seedUrl,
        ...(kit.seedBranch !== null && { branch: kit.seedBranch }),
        commit: kit.seedCommit,
      });
    put(ANN_STARTER_KIT_DEFAULT_MODEL, kit.defaultModel ?? undefined);
    if (kit.pendingCommit !== null && kit.pendingStartedAt !== null)
      annotations[ANN_KIT_UPDATE_PENDING] = JSON.stringify({
        targetCommit: kit.pendingCommit,
        startedAt: kit.pendingStartedAt.toISOString(),
      });
    put(ANN_KIT_UPDATE_SKIPPED, kit.skippedCommit ?? undefined);
  }
  if (status) {
    put(ANN_MACHINE_UP, TIME_OF(status.machineUpAt));
    put(ANN_MACHINE_DOWN, TIME_OF(status.machineDownAt));
    put(ANN_MEMORY_WAIT_UNTIL, TIME_OF(status.memoryWaitUntil));
    put(ANN_RUNNER_OOM_KILL, status.runnerOomKillId ?? undefined);
    put(ANN_RUNNER_OOM_RECOVERED, status.runnerOomRecoveredId ?? undefined);
  }

  const spec: Record<string, unknown> = {
    image: agent.image,
    name: agent.name,
    resources: {
      limits: { cpu: agent.cpuLimit, memory: agent.memoryLimit },
    },
  };
  const putSpec = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "")
      spec[key] = value;
  };
  putSpec("description", agent.description);
  putSpec("avatar", agent.avatar);
  if (agent.whispersOff) spec.whispersOff = true;
  putSpec("harness", agent.harness);
  putSpec("imagePullSecretRef", agent.imagePullSecretRef);
  putSpec("secretRef", agent.secretRef);
  putSpec(
    "hibernationTimeout",
    agent.hibernationTimeoutNs === null
      ? undefined
      : goDuration(agent.hibernationTimeoutNs),
  );
  if (agent.nestedVirtualization) spec.nestedVirtualization = true;
  if (agent.requireConnectionAddress) spec.requireConnectionAddress = true;
  putSpec("telemetryAttributionId", agent.telemetryAttributionId);
  putSpec("environmentOf", agent.environmentOf);
  putSpec("storageSize", agent.diskSize);
  if (hosts.length > 0) spec.l7Hosts = hosts;
  if (grants.length > 0) spec.grantedConnectionIds = grants;

  const labels: Record<string, string> = { [LABEL_OWNER]: agent.ownerSub };
  if (agent.templateId !== null) labels[LABEL_TEMPLATE_REF] = agent.templateId;

  const observed = conditions.map((condition) => ({
    type: condition.type,
    status: condition.status,
    reason: condition.reason,
    message: condition.message,
    observedGeneration: condition.observedGeneration,
    lastTransitionTime: condition.lastTransitionAt.toISOString(),
  }));

  return {
    apiVersion: "agent-platform.ai/v1",
    kind: "Agent",
    metadata: {
      name: agent.id,
      uid: agent.incarnation,
      generation: agent.generation,
      resourceVersion: String(agent.generation),
      creationTimestamp: agent.createdAt.toISOString(),
      labels,
      annotations,
    } as Meta,
    spec,
    status: {
      ...(observed.length > 0 && { conditions: observed }),
      ...(status && {
        observedGeneration: status.observedGeneration,
        ...(status.machineRestarts > 0 && {
          agentPodRestarts: status.machineRestarts,
        }),
        ...(status.machineRestartReason !== null && {
          agentPodRestartReason: status.machineRestartReason,
        }),
      }),
    },
  };
}
