import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/** Namespace the controller renders agent + gateway workloads into. */
export const AGENT_NS = process.env.E2E_AGENT_NS ?? "platform-agents";
/** Namespace the platform components run in. */
const RELEASE_NS = process.env.E2E_RELEASE_NS ?? "default";
/** Helm release name; the chart renders workloads as `<release>-<component>`. */
const RELEASE = process.env.E2E_RELEASE_NAME ?? "platform";

/** Resolved the same way the e2e mise tasks do. */
function kubeconfig(): string {
  if (process.env.KUBECONFIG) return process.env.KUBECONFIG;
  if (process.env.IS_SANDBOX) return "/etc/rancher/k3s/k3s.yaml";
  const limaHome = process.env.LIMA_HOME ?? join(homedir(), ".lima");
  const vm = process.env.E2E_VM_NAME ?? "platform-k3s-test";
  return join(limaHome, vm, "copied-from-guest", "kubeconfig.yaml");
}

/** Only for specs asserting controller behaviour with no API surface. */
export function kubectl(...args: string[]): string {
  return execFileSync("kubectl", ["--kubeconfig", kubeconfig(), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Yields "" instead of throwing — for polling resources that come and go. */
function kubectlOrEmpty(...args: string[]): string {
  try {
    return kubectl(...args);
  } catch {
    return "";
  }
}

function get(kind: string, name: string, jsonpath: string): string {
  return kubectlOrEmpty(
    "-n",
    AGENT_NS,
    "get",
    kind,
    name,
    "-o",
    `jsonpath={${jsonpath}}`,
  );
}

export function statefulSetField(name: string, jsonpath: string): string {
  return get("sts", name, jsonpath);
}

export function podField(name: string, jsonpath: string): string {
  return get("pod", name, jsonpath);
}

/** Filter projection: a `range` without `{end}` silently dumps whole objects. */
function conditionPath(type: string): string {
  return `.status.conditions[?(@.type=="${type}")].status`;
}

export function agentConditionStatus(agent: string, type: string): string {
  return get("agents.agent-platform.ai", agent, conditionPath(type));
}

export function podIsReady(name: string): boolean {
  return get("pod", name, conditionPath("Ready")) === "True";
}

/** Reason+message of every event on a pod, newline-separated. */
export function podEvents(name: string): string {
  return kubectlOrEmpty(
    "-n",
    AGENT_NS,
    "get",
    "events",
    "--field-selector",
    `involvedObject.name=${name}`,
    "-o",
    "custom-columns=REASON:.reason,MSG:.message",
    "--no-headers",
  );
}

/** Teardown fallback when the API is unusable (e.g. an expired token). */
export function deleteAgentCr(name: string): void {
  kubectlOrEmpty(
    "-n",
    AGENT_NS,
    "delete",
    "agents.agent-platform.ai",
    name,
    "--ignore-not-found",
  );
}

/** Parking is cluster-wide — always restore in a finally. Scaling to 0 waits
 *  for the pod to go, so no reconcile races what the caller does next. */
export function scaleController(replicas: 0 | 1): void {
  kubectl(
    "-n",
    RELEASE_NS,
    "scale",
    "deploy",
    `${RELEASE}-controller`,
    `--replicas=${replicas}`,
  );
  if (replicas === 0) {
    kubectlOrEmpty(
      "-n",
      RELEASE_NS,
      "wait",
      "--for=delete",
      "pod",
      "-l",
      "app.kubernetes.io/component=controller",
      "--timeout=60s",
    );
  }
}
