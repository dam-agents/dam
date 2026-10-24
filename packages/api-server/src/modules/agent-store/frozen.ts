import type * as k8s from "@kubernetes/client-node";

export const FROZEN_ENV = "PLATFORM_AGENT_STORE_FROZEN";

export interface FrozenDeployment {
  name: string;
  component: string;
  frozenTemplate: boolean;
  replicas: number;
  pods: number;
  readyPods: number;
}

export interface FrozenLease {
  holder: string | null;
  renewedAt: Date | null;
  durationSeconds: number;
}

export interface FrozenState {
  deployments: FrozenDeployment[];
  lease: FrozenLease;
  now: Date;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what "the components are frozen" must mean before a
 * rollback touches a row, observed from the cluster rather than from the
 * operator's shell.
 *
 * The freeze is a value that reaches the Deployments through git, so an
 * operator's command can run minutes before Flux applies it. A refusal is the
 * only safe answer until the cluster shows it: both Deployments must render the
 * frozen value, run no replica and have no pod left, and the controller's Lease
 * must not have been renewed inside its duration. Otherwise a live api-server
 * reads the rows the rollback deletes as a fleet that vanished and reaps every
 * per-agent record, and a live controller re-creates the anchors the rollback
 * just orphaned.
 */
export function frozenRefusals(state: FrozenState): string[] {
  const refusals: string[] = [];
  const wanted = ["apiserver", "controller"];
  for (const component of wanted) {
    const found = state.deployments.find((one) => one.component === component);
    if (!found) {
      refusals.push(
        `no ${component} Deployment was found in the release namespace: the freeze cannot be observed, so the rollback must not run`,
      );
      continue;
    }
    if (!found.frozenTemplate)
      refusals.push(
        `the ${component} Deployment ${found.name} does not render ${FROZEN_ENV}=true: its next pod would serve and write. Wait for the frozen release to roll out (Flux applies it on its own interval, ten minutes by default).`,
      );
    if (found.replicas !== 0)
      refusals.push(
        `the ${component} Deployment ${found.name} has ${found.replicas} desired replica(s): a frozen release renders 0. Wait for the rollout.`,
      );
    if (found.pods > 0)
      refusals.push(
        `the ${component} Deployment ${found.name} still has ${found.pods} pod(s) (${found.readyPods} ready): the old writers have not gone.`,
      );
  }
  const { lease, now } = state;
  if (
    lease.holder !== null &&
    lease.renewedAt !== null &&
    now.getTime() - lease.renewedAt.getTime() <= lease.durationSeconds * 1_000
  )
    refusals.push(
      `the controller Lease is still held by ${lease.holder} (renewed ${Math.max(0, Math.round((now.getTime() - lease.renewedAt.getTime()) / 1_000))}s ago): a controller is running and would re-create the anchors the rollback removes.`,
    );
  return refusals;
}

const envValue = (container: k8s.V1Container, name: string): string | null =>
  (container.env ?? []).find((entry) => entry.name === name)?.value ?? null;

const templateIsFrozen = (template: k8s.V1PodTemplateSpec): boolean =>
  (template.spec?.containers ?? []).some(
    (container) => envValue(container, FROZEN_ENV) === "true",
  );

const selectorOf = (deployment: k8s.V1Deployment): string =>
  Object.entries(deployment.spec?.selector?.matchLabels ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(",");

export async function readFrozenState(deps: {
  apps: k8s.AppsV1Api;
  api: k8s.CoreV1Api;
  leases: k8s.CoordinationV1Api;
  namespace: string;
  leaseNamespace: string;
  releaseName: string;
  leaseName: string;
  now?: Date;
}): Promise<FrozenState> {
  const now = deps.now ?? new Date();
  const listed = await deps.apps.listNamespacedDeployment({
    namespace: deps.namespace,
  });
  const named: Record<string, string> = {
    [`${deps.releaseName}-apiserver`]: "apiserver",
    [`${deps.releaseName}-controller`]: "controller",
  };
  const deployments: FrozenDeployment[] = [];
  for (const deployment of listed.items ?? []) {
    const component = named[deployment.metadata?.name ?? ""];
    if (component === undefined) continue;
    const selector = selectorOf(deployment);
    const pods =
      selector === ""
        ? []
        : ((
            await deps.api.listNamespacedPod({
              namespace: deps.namespace,
              labelSelector: selector,
            })
          ).items ?? []);
    deployments.push({
      name: deployment.metadata?.name ?? "",
      component,
      frozenTemplate: templateIsFrozen(
        deployment.spec?.template ?? ({} as k8s.V1PodTemplateSpec),
      ),
      replicas: deployment.spec?.replicas ?? 1,
      pods: pods.length,
      readyPods: pods.filter((pod) =>
        (pod.status?.conditions ?? []).some(
          (condition) =>
            condition.type === "Ready" && condition.status === "True",
        ),
      ).length,
    });
  }

  let lease: FrozenLease = {
    holder: null,
    renewedAt: null,
    durationSeconds: 0,
  };
  try {
    const live = await deps.leases.readNamespacedLease({
      name: deps.leaseName,
      namespace: deps.leaseNamespace,
    });
    const renewTime = live.spec?.renewTime;
    lease = {
      holder: live.spec?.holderIdentity ?? null,
      renewedAt:
        renewTime === undefined || renewTime === null
          ? null
          : new Date(String(renewTime)),
      durationSeconds: live.spec?.leaseDurationSeconds ?? 0,
    };
  } catch (cause) {
    if (!(
      cause instanceof Error &&
      "code" in cause &&
      (cause as { code: unknown }).code === 404
    ))
      throw cause;
  }
  return { deployments, lease, now };
}
