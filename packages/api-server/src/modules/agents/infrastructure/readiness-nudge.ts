import type { K8sClient } from "./k8s.js";

export interface ReadyNudge {
  wait(maxMs: number): Promise<void>;
  stop(): void;
}

export function createReadyNudge(
  k8s: Pick<K8sClient, "watchCustomObject">,
  plural: string,
  name: string,
): ReadyNudge {
  let nudged = false;
  let wake: (() => void) | null = null;
  const stopWatch = k8s.watchCustomObject(
    plural,
    name,
    () => {
      nudged = true;
      wake?.();
    },
    () => {},
  );
  return {
    wait(maxMs) {
      if (nudged) {
        nudged = false;
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          wake = null;
          resolve();
        }, maxMs);
        timer.unref();
        wake = () => {
          clearTimeout(timer);
          wake = null;
          nudged = false;
          resolve();
        };
      });
    },
    stop() {
      stopWatch();
    },
  };
}
