import { spawnSync } from "node:child_process";
import * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";

const KUBECONFIG = process.env.IS_SANDBOX
  ? "/etc/rancher/k3s/k3s.yaml"
  : `${process.env.HOME}/.lima/humr-k3s-test/copied-from-guest/kubeconfig.yaml`;
const NAMESPACE = "humr-agents";

function loadApi() {
  const kc = new k8s.KubeConfig();
  kc.loadFromFile(KUBECONFIG);
  return kc.makeApiClient(k8s.CoreV1Api);
}

const api = loadApi();

export async function getConfigMap(
  name: string,
  namespace = NAMESPACE,
): Promise<k8s.V1ConfigMap> {
  return api.readNamespacedConfigMap({ name, namespace });
}

export async function configMapExists(
  name: string,
  namespace = NAMESPACE,
): Promise<boolean> {
  try {
    await api.readNamespacedConfigMap({ name, namespace });
    return true;
  } catch {
    return false;
  }
}

export async function patchConfigMapData(
  name: string,
  key: string,
  value: string,
  namespace = NAMESPACE,
): Promise<void> {
  const cm = await api.readNamespacedConfigMap({ name, namespace });
  cm.data = { ...cm.data, [key]: value };
  await api.replaceNamespacedConfigMap({ name, namespace, body: cm });
}

async function findStuckPVCForPod(
  pod: k8s.V1Pod,
  namespace: string,
): Promise<{ name: string; reason: string } | null> {
  const claims = (pod.spec?.volumes ?? [])
    .map((v) => v.persistentVolumeClaim?.claimName)
    .filter((n): n is string => Boolean(n));
  if (claims.length === 0) return null;

  for (const claimName of claims) {
    try {
      const pvc = await api.readNamespacedPersistentVolumeClaim({
        name: claimName,
        namespace,
      });
      if (pvc.status?.phase !== "Pending") continue;

      const events = await api.listNamespacedEvent({ namespace });
      const failed = events.items
        .filter(
          (e) =>
            e.involvedObject?.name === claimName &&
            e.reason === "ProvisioningFailed",
        )
        .sort(
          (a, b) =>
            (a.lastTimestamp?.getTime() ?? 0) -
            (b.lastTimestamp?.getTime() ?? 0),
        )
        .pop();
      if (failed && (failed.count ?? 1) >= 2) {
        return {
          name: claimName,
          reason: failed.message ?? "ProvisioningFailed",
        };
      }
    } catch {}
  }
  return null;
}

export async function waitForPodReady(
  name: string,
  timeoutMs = 120_000,
  namespace = NAMESPACE,
): Promise<void> {
  const start = Date.now();
  let lastError: string | undefined;
  let bailedEarly = false;

  while (Date.now() - start < timeoutMs) {
    try {
      const pod = await api.readNamespacedPod({ name, namespace });
      const ready = pod.status?.conditions?.find((c) => c.type === "Ready");
      if (ready?.status === "True") return;
      // Bail fast on permanent scheduling failures — polling won't help when
      // the node is out of resources, only diagnostic noise.
      const scheduled = pod.status?.conditions?.find(
        (c) => c.type === "PodScheduled",
      );
      if (
        scheduled?.status === "False" &&
        scheduled.reason === "Unschedulable"
      ) {
        lastError = `Unschedulable: ${scheduled.message ?? "no message"}`;
        bailedEarly = true;
        break;
      }
      // Pod might be scheduled but stuck waiting on a PVC (e.g. NFS
      // provisioner out of disk). The pod itself shows no events; the cause
      // is on the PVC. Surface that without waiting out the full timeout.
      const stuckPVC = await findStuckPVCForPod(pod, namespace);
      if (stuckPVC) {
        lastError = `PVC ${stuckPVC.name} stuck: ${stuckPVC.reason}`;
        bailedEarly = true;
        break;
      }
      lastError = `phase=${pod.status?.phase ?? "Unknown"}, ready=${ready?.status ?? "no condition"}`;
    } catch (e) {
      lastError =
        e instanceof Error ? e.message : "unknown error reading pod";
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  const elapsed = bailedEarly ? "(bailed early)" : `after ${timeoutMs}ms`;
  const diag: string[] = [
    `Pod ${name} not ready ${elapsed} (last poll: ${lastError})`,
    "",
    "=== Pod Describe ===",
    await describePod(name, namespace),
    "",
    "=== Pod Events ===",
    await getEvents(name, namespace),
    "",
    "=== PVC Status ===",
    await describePodPVCs(name, namespace),
    "",
    "=== Controller Logs ===",
    await dumpPodLogs("app.kubernetes.io/component=controller"),
  ];

  throw new Error(diag.join("\n"));
}

export async function waitForConfigMapKey(
  name: string,
  key: string,
  timeoutMs = 90_000,
  namespace = NAMESPACE,
): Promise<k8s.V1ConfigMap> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const cm = await api.readNamespacedConfigMap({ name, namespace });
      if (cm.data?.[key]) return cm;
    } catch {}
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(
    `ConfigMap ${name} key "${key}" not found after ${timeoutMs}ms`,
  );
}

/**
 * Poll a ConfigMap's `status.yaml` until the predicate returns true.
 * Scheduler now writes an initial `status.yaml` with just `nextRun` at
 * registration time (so the UI sees an upcoming fire before one happens),
 * which means "key exists" is no longer enough to tell whether the schedule
 * has actually fired — callers waiting for `lastResult` must poll content.
 */
export async function waitForScheduleStatus(
  name: string,
  predicate: (status: Record<string, unknown>) => boolean,
  timeoutMs = 90_000,
  namespace = NAMESPACE,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const cm = await api.readNamespacedConfigMap({ name, namespace });
      const raw = cm.data?.["status.yaml"];
      if (raw) {
        const status = yaml.load(raw) as Record<string, unknown>;
        if (predicate(status)) return status;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(
    `ConfigMap ${name} status.yaml predicate not satisfied after ${timeoutMs}ms`,
  );
}

export async function describePod(
  name: string,
  namespace = NAMESPACE,
): Promise<string> {
  try {
    const pod = await api.readNamespacedPod({ name, namespace });
    const lines: string[] = [`Pod: ${name} (namespace: ${namespace})`];

    lines.push(`Phase: ${pod.status?.phase ?? "Unknown"}`);

    for (const cond of pod.status?.conditions ?? []) {
      lines.push(
        `  ${cond.type}: ${cond.status}${cond.reason ? ` (${cond.reason})` : ""}${cond.message ? ` — ${cond.message}` : ""}`,
      );
    }

    const formatStatus = (cs: k8s.V1ContainerStatus) => {
      const state = cs.state?.waiting
        ? `Waiting: ${cs.state.waiting.reason ?? "unknown"}${cs.state.waiting.message ? ` — ${cs.state.waiting.message}` : ""}`
        : cs.state?.running
          ? `Running since ${cs.state.running.startedAt}`
          : cs.state?.terminated
            ? `Terminated: ${cs.state.terminated.reason ?? "unknown"} (exit ${cs.state.terminated.exitCode})`
            : "Unknown";
      return `  Container ${cs.name}: ${state} (restarts: ${cs.restartCount})`;
    };

    for (const cs of pod.status?.initContainerStatuses ?? []) {
      lines.push(formatStatus(cs));
    }
    for (const cs of pod.status?.containerStatuses ?? []) {
      lines.push(formatStatus(cs));
    }

    return lines.join("\n");
  } catch (e) {
    return `describePod(${name}): ${e instanceof Error ? e.message : e}`;
  }
}

export async function getEvents(
  name: string,
  namespace = NAMESPACE,
): Promise<string> {
  try {
    const events = await api.listNamespacedEvent({ namespace });
    const relevant = events.items
      .filter((e) => e.involvedObject?.name === name)
      .sort(
        (a, b) =>
          (a.lastTimestamp?.getTime() ?? 0) -
          (b.lastTimestamp?.getTime() ?? 0),
      )
      .slice(-20);

    if (relevant.length === 0) return `No events for ${name} in ${namespace}`;

    return relevant
      .map(
        (e) =>
          `[${e.type}] ${e.reason}: ${e.message} (${e.count ?? 1}x, last: ${e.lastTimestamp?.toISOString() ?? "?"})`,
      )
      .join("\n");
  } catch (e) {
    return `getEvents(${name}): ${e instanceof Error ? e.message : e}`;
  }
}

async function describePodPVCs(
  podName: string,
  namespace: string,
): Promise<string> {
  try {
    const pod = await api.readNamespacedPod({ name: podName, namespace });
    const claims = (pod.spec?.volumes ?? [])
      .map((v) => v.persistentVolumeClaim?.claimName)
      .filter((n): n is string => Boolean(n));
    if (claims.length === 0) return "Pod has no PVCs";

    const lines: string[] = [];
    for (const claim of claims) {
      try {
        const pvc = await api.readNamespacedPersistentVolumeClaim({
          name: claim,
          namespace,
        });
        const requested = pvc.spec?.resources?.requests?.storage ?? "?";
        lines.push(
          `PVC ${claim}: phase=${pvc.status?.phase ?? "Unknown"}, requested=${requested}, storageClass=${pvc.spec?.storageClassName ?? "<default>"}`,
        );
        const events = await api.listNamespacedEvent({ namespace });
        const recent = events.items
          .filter((e) => e.involvedObject?.name === claim)
          .sort(
            (a, b) =>
              (a.lastTimestamp?.getTime() ?? 0) -
              (b.lastTimestamp?.getTime() ?? 0),
          )
          .slice(-5);
        for (const e of recent) {
          lines.push(
            `  [${e.type}] ${e.reason}: ${e.message} (${e.count ?? 1}x)`,
          );
        }
      } catch (e) {
        lines.push(
          `PVC ${claim}: read failed — ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    return lines.join("\n");
  } catch (e) {
    return `describePodPVCs(${podName}): ${e instanceof Error ? e.message : e}`;
  }
}

export async function describeConfigMap(
  name: string,
  namespace = NAMESPACE,
): Promise<string> {
  try {
    const cm = await api.readNamespacedConfigMap({ name, namespace });
    const lines: string[] = [`ConfigMap: ${name} (namespace: ${namespace})`];
    lines.push(`Labels: ${JSON.stringify(cm.metadata?.labels ?? {})}`);
    for (const [key, value] of Object.entries(cm.data ?? {})) {
      lines.push(`--- ${key} ---`, value);
    }
    return lines.join("\n");
  } catch (e) {
    return `describeConfigMap(${name}): ${e instanceof Error ? e.message : e}`;
  }
}

/**
 * Run a command inside a pod's container. Returns stdout/stderr/exit code.
 * Doesn't throw on non-zero — callers commonly *expect* a non-zero exit
 * (e.g. curl 28 on a held-then-timed-out request).
 */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function execInPod(
  podName: string,
  container: string,
  command: readonly string[],
  opts: { timeoutMs?: number; namespace?: string } = {},
): ExecResult {
  const namespace = opts.namespace ?? NAMESPACE;
  const result = spawnSync(
    "kubectl",
    [
      "--kubeconfig", KUBECONFIG,
      "exec",
      "-n", namespace,
      podName,
      "-c", container,
      "--",
      ...command,
    ],
    { encoding: "utf8", timeout: opts.timeoutMs ?? 30_000 },
  );
  return {
    // spawnSync returns null for status when killed by signal (incl. timeout);
    // surface that as a distinct non-zero so callers can branch.
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export async function dumpPodLogs(
  labelSelector: string,
  namespace = "default",
  tailLines = 200,
): Promise<string> {
  try {
    const pods = await api.listNamespacedPod({ namespace, labelSelector });
    const lines: string[] = [];
    for (const pod of pods.items) {
      const name = pod.metadata!.name!;
      const allContainers = [
        ...(pod.spec?.initContainers ?? []),
        ...(pod.spec?.containers ?? []),
      ];
      for (const container of allContainers) {
        try {
          const log = await api.readNamespacedPodLog({
            name,
            namespace,
            container: container.name,
            tailLines,
          });
          lines.push(`--- ${name}/${container.name} ---`, log);
        } catch (e) {
          lines.push(`--- ${name}/${container.name} --- ERROR: ${e}`);
        }
      }
    }
    return lines.join("\n");
  } catch (e) {
    return `dumpPodLogs failed: ${e}`;
  }
}
