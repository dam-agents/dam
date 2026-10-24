import { connectionGrants, inArray, type Db } from "db";
import { parseGoDurationNs } from "../../duration.js";
import type { Logger } from "../../core/logger.js";
import type { KubeObject } from "../agents/infrastructure/k8s.js";
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
  ANN_RUNNER_OOM_KILL,
  ANN_RUNNER_OOM_RECOVERED,
  ANN_ROLL_REV,
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

const comparables = (quantity: string): bigint | null => {
  const match = COMPARABLE.exec(quantity);
  if (!match?.[1]) return null;
  const multiplier = MULTIPLIERS.get(match[2] ?? "");
  if (multiplier === undefined) return null;
  const [whole = "0", fraction = ""] = match[1].split(".");
  return (
    (BigInt(whole + fraction) * multiplier) / 10n ** BigInt(fraction.length)
  );
};

export type Refusal = { id: string; reason: string };

export interface MappedAgent {
  id: string;
  rows: Record<string, unknown> | undefined;
  dropped: string[];
  normalized: string[];
  refusal?: string;
}

export interface MappedBudget {
  ownerSub: string;
  row: Record<string, unknown> | undefined;
  dropped: string[];
  normalized: string[];
  refusal?: string;
}

export interface AbsorbPreview {
  agents: {
    seen: number;
    importable: number;
    refused: Refusal[];
    dropped: Record<string, number>;
    normalized: Record<string, number>;
  };
  budgets: {
    seen: number;
    importable: number;
    refused: Refusal[];
    dropped: Record<string, number>;
    normalized: Record<string, number>;
  };
  connectionGrants: { onlyInResource: Refusal[]; onlyInDatabase: Refusal[] };
}

export interface AgentStoreDefaults {
  cpuLimit: string;
  memoryLimit: string;
}

type Spec = Record<string, unknown>;
type Meta = NonNullable<KubeObject["metadata"]> & {
  creationTimestamp?: string;
  deletionTimestamp?: string;
};
type Annotations = Record<string, string>;

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

const nestedVirtualizationOf = (spec: Spec): boolean =>
  (spec.backend as { vm?: { nestedVirtualization?: unknown } } | undefined)?.vm
    ?.nestedVirtualization === true || spec.nestedVirtualization === true;

const mountList = (spec: Spec): Array<Record<string, unknown>> =>
  Array.isArray(spec.mounts)
    ? (spec.mounts as Array<Record<string, unknown>>)
    : [];

/**
 * UNIT_BOUNDARY_DESCRIPTION: Turns stored custom resources into the rows they
 * would become, and says what that loses — the dry run the switch's report
 * needs before anything writes.
 *
 * An Agent that cannot become a row is refused with its reason rather than
 * repaired, because a repaired Agent would render a different machine than the
 * one running today; the report is where an operator meets that. Values that
 * decide a machine's identity are copied verbatim, and a flag the custom
 * resource carries without a timestamp takes the moment of the switch, which is
 * the only time it is known.
 *
 * The nesting ask has two homes, because the custom resource keeps it under
 * `spec.backend.vm` while the column is its own: an Agent from either shape
 * reads the same here, and the rebuild puts it back where the controller looks.
 * Annotations it does not recognize are counted, not carried and not listed by
 * name: an operator-authored key has no reader after the switch, and turning it
 * into one would create a configuration surface nobody asked for.
 * The reclaim mark is dropped rather than carried: that column has exactly one
 * writer, the controller, and a mark written by the absorb would be one the
 * controller never made. It is a display hint until the next early hibernation
 * sets it again.
 */
export function mapAgent(
  cr: KubeObject,
  defaults: AgentStoreDefaults,
  switchedAt: string,
): MappedAgent {
  const metadata = (cr.metadata ?? {}) as Meta;
  const spec = (cr.spec ?? {}) as Spec;
  const annotations = (metadata.annotations ?? {}) as Annotations;
  const dropped: string[] = [];
  const normalized: string[] = [];
  const id = metadata.name ?? "";

  const refuse = (reason: string): MappedAgent => ({
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
    return refuse(`the lifetime annotation is not a number of milliseconds`);

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
  const kitState = {
    agentId: id,
    starterKit: nullable(annotations[ANN_STARTER_KIT]),
    onboardedAt: nullable(annotations[ANN_STARTER_KIT_ONBOARDED]),
    seedUrl: seedComplete ? nullable(seed?.url) : null,
    seedBranch: seedComplete ? nullable(seed?.branch) : null,
    seedCommit: seedComplete ? commit(seed?.commit) : null,
    defaultModel: nullable(annotations[ANN_STARTER_KIT_DEFAULT_MODEL]),
    pendingCommit: pendingComplete ? commit(pending?.targetCommit) : null,
    pendingStartedAt: pendingComplete ? nullable(pending?.startedAt) : null,
    skippedCommit: commit(annotations[ANN_KIT_UPDATE_SKIPPED]),
    updatedAt: switchedAt,
  };
  const kitPresent = Object.entries(kitState).some(
    ([key, value]) => !["agentId", "updatedAt"].includes(key) && value !== null,
  );

  const status = cr.status as
    | {
        observedGeneration?: number;
        agentPodRestarts?: number;
        agentPodRestartReason?: string;
        conditions?: Array<Record<string, unknown>>;
      }
    | undefined;
  const conditions = (status?.conditions ?? []).flatMap((condition) => {
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
        message: typeof condition.message === "string" ? condition.message : "",
        observedGeneration: Number(condition.observedGeneration ?? 0),
        lastTransitionAt: transition,
      },
    ];
  });

  if (annotations[RECLAIMED_AT_KEY] !== undefined)
    normalized.push("reclaimMark.dropped");
  const lastActivityAt = nullable(annotations[LAST_ACTIVITY_KEY]);
  const flaggedAt = (flag: string | undefined) =>
    flag ? (lastActivityAt ?? switchedAt) : null;

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
        nestedVirtualization: nestedVirtualizationOf(spec),
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
        createdAt: metadata.creationTimestamp,
        updatedAt: metadata.creationTimestamp,
      },
      signals: {
        agentId: id,
        lastActivityAt,
        sessionPinned: annotations[ACTIVE_SESSION_KEY] === "true",
        invocationPinned: annotations[INVOCATIONS_ACTIVE_KEY] === "true",
        stopRequestedAt: flaggedAt(annotations[STOP_REQUESTED_KEY]),
        disabledAt: flaggedAt(annotations[DISABLED_KEY]),
        rollRev: annotations[ANN_ROLL_REV] ?? "",
      },
      kit: kitPresent ? kitState : undefined,
      status: {
        agentId: id,
        observedGeneration: Number(status?.observedGeneration ?? 0),
        machineRestarts: Number(status?.agentPodRestarts ?? 0),
        machineRestartReason: nullable(status?.agentPodRestartReason),
        machineUpAt: nullable(annotations[ANN_MACHINE_UP]),
        machineDownAt: nullable(annotations[ANN_MACHINE_DOWN]),
        memoryWaitUntil: nullable(annotations[ANN_MEMORY_WAIT_UNTIL]),
        runnerOomKillId: nullable(annotations[ANN_RUNNER_OOM_KILL]),
        runnerOomRecoveredId: nullable(annotations[ANN_RUNNER_OOM_RECOVERED]),
      },
      conditions,
      hosts: hosts.map((host) => ({ agentId: id, host })),
    },
  };
}

export function mapBudget(cr: KubeObject): MappedBudget {
  const metadata = (cr.metadata ?? {}) as Meta;
  const spec = (cr.spec ?? {}) as Spec;
  const ownerSub =
    text(spec.owner) ?? (metadata.name ?? "").replace(/^budget-/u, "");
  const dropped: string[] = [];
  const normalized: string[] = [];
  const refuse = (reason: string): MappedBudget => ({
    ownerSub,
    row: undefined,
    dropped,
    normalized,
    refusal: reason,
  });

  if (metadata.deletionTimestamp)
    return refuse("the resource is being deleted");
  if (!ownerSub || ownerSub.length > 246)
    return refuse("the budget names no owner subject the column can hold");

  const quantity = (name: string): string | null | Error => {
    const raw = spec[name];
    if (raw === undefined || raw === null) return null;
    const value = typeof raw === "string" ? raw : JSON.stringify(raw);
    return QUANTITY.test(value)
      ? value
      : new Error(`${name} is not a quantity`);
  };
  const cpu = quantity("cpu");
  const memory = quantity("memory");
  const storage = quantity("storage");
  for (const field of [cpu, memory, storage])
    if (field instanceof Error) return refuse(field.message);
  if (cpu === null && memory === null && storage === null)
    return refuse("the budget carries no override, so it would be deleted");
  if (cr.status !== undefined) dropped.push("status");

  return {
    ownerSub,
    dropped,
    normalized,
    row: {
      ownerSub,
      cpu,
      memory,
      storage,
      setBySub: null,
      operatorUpdatedAt: null,
      createdAt: metadata.creationTimestamp,
      updatedAt: metadata.creationTimestamp,
    },
  };
}

const tally = (fields: string[], into: Record<string, number>): void => {
  for (const field of fields) into[field] = (into[field] ?? 0) + 1;
};

export function previewAgentStore(input: {
  agents: KubeObject[];
  budgets: KubeObject[];
  grants: Array<{ agentId: string; connectionId: string }>;
  defaults: AgentStoreDefaults;
  switchedAt: string;
}): AbsorbPreview {
  const mappedAgents = input.agents.map((cr) =>
    mapAgent(cr, input.defaults, input.switchedAt),
  );
  const mappedBudgets = input.budgets.map(mapBudget);

  const grantedOnResource = new Map<string, Set<string>>(
    input.agents.map((cr) => [
      cr.metadata?.name ?? "",
      new Set(
        Array.isArray((cr.spec as Spec | undefined)?.grantedConnectionIds)
          ? ((cr.spec as Spec).grantedConnectionIds as string[])
          : [],
      ),
    ]),
  );
  const grantedInDatabase = new Map<string, Set<string>>();
  for (const grant of input.grants) {
    const set = grantedInDatabase.get(grant.agentId) ?? new Set<string>();
    set.add(grant.connectionId);
    grantedInDatabase.set(grant.agentId, set);
  }

  const onlyInResource: Refusal[] = [];
  const onlyInDatabase: Refusal[] = [];
  for (const id of new Set([
    ...grantedOnResource.keys(),
    ...grantedInDatabase.keys(),
  ])) {
    const resource = grantedOnResource.get(id) ?? new Set<string>();
    const database = grantedInDatabase.get(id) ?? new Set<string>();
    const missingInDatabase = [...resource].filter((one) => !database.has(one));
    const missingOnResource = [...database].filter((one) => !resource.has(one));
    if (missingInDatabase.length > 0)
      onlyInResource.push({
        id,
        reason: `granted only on the resource: ${missingInDatabase.join(", ")}`,
      });
    if (missingOnResource.length > 0)
      onlyInDatabase.push({
        id,
        reason: `granted only in the database: ${missingOnResource.join(", ")}`,
      });
  }

  const counted = (
    maps: Array<{ dropped: string[]; normalized: string[] }>,
    pick: "dropped" | "normalized",
  ) => {
    const into: Record<string, number> = {};
    for (const one of maps) tally(one[pick], into);
    return into;
  };

  return {
    agents: {
      seen: mappedAgents.length,
      importable: mappedAgents.filter((one) => one.refusal === undefined)
        .length,
      refused: mappedAgents
        .filter(
          (one): one is MappedAgent & { refusal: string } =>
            one.refusal !== undefined,
        )
        .map((one) => ({ id: one.id, reason: one.refusal })),
      dropped: counted(mappedAgents, "dropped"),
      normalized: counted(mappedAgents, "normalized"),
    },
    budgets: {
      seen: mappedBudgets.length,
      importable: mappedBudgets.filter((one) => one.refusal === undefined)
        .length,
      refused: mappedBudgets
        .filter(
          (one): one is MappedBudget & { refusal: string } =>
            one.refusal !== undefined,
        )
        .map((one) => ({ id: one.ownerSub, reason: one.refusal })),
      dropped: counted(mappedBudgets, "dropped"),
      normalized: counted(mappedBudgets, "normalized"),
    },
    connectionGrants: { onlyInResource, onlyInDatabase },
  };
}

export async function readConnectionGrants(
  db: Db,
  agentIds: string[],
): Promise<Array<{ agentId: string; connectionId: string }>> {
  if (agentIds.length === 0) return [];
  return db
    .select({
      agentId: connectionGrants.agentId,
      connectionId: connectionGrants.connectionId,
    })
    .from(connectionGrants)
    .where(inArray(connectionGrants.agentId, agentIds));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Logs what an absorb would do, and writes nothing.
 *
 * It runs at startup behind a chart value because the report is the operator's
 * evidence that the switch is safe on this install: which records would become
 * rows, which would be refused and why, what the move would drop, and where the
 * connection grants disagree with the database — the one disagreement that
 * changes egress authority. Never fatal: a preview that failed is a separate
 * finding from a platform that cannot boot.
 */
export async function reportAbsorbPreview(input: {
  listCustomObjects: (plural: string) => Promise<KubeObject[]>;
  db: Db;
  logger: Logger;
  defaults: AgentStoreDefaults;
}): Promise<void> {
  try {
    const agents = await input.listCustomObjects("agents");
    const budgets = await input.listCustomObjects("userbudgets");
    const grants = await readConnectionGrants(
      input.db,
      agents.map((cr) => cr.metadata?.name ?? "").filter((id) => id !== ""),
    );
    const preview = previewAgentStore({
      agents,
      budgets,
      grants,
      defaults: input.defaults,
      switchedAt: new Date().toISOString(),
    });
    input.logger.info({ preview }, "agentStore.absorbPreview");
  } catch (cause) {
    input.logger.warn(
      { error: cause instanceof Error ? cause.message : String(cause) },
      "agentStore.absorbPreview.failed",
    );
  }
}
