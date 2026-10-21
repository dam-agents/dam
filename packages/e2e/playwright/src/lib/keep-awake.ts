import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const everyMs = 30_000;

export interface KeepAwake {
  stop(): void;
  failures: number;
  lastFailure: string;
}

// UNIT_BOUNDARY_DESCRIPTION: what keeps a vm Agent out of the idle sweep, which hibernates a machine whose last activity is older than the chart-wide `controller.agent.base.vmIdleTimeout`: a wake writes the `agent-platform.ai/last-activity` stamp that sweep reads, and this writes one every `everyMs`. A vm Agent ignores its own hibernation timeout, so this is the only thing that decides for that lane. The interval is the caller's to stop, and a wake that fails is counted rather than thrown: the spec that keeps a machine awake through an upgrade expects the api-server itself to roll, so one refusal must not fail the spec, and the first failure is logged because a keep-awake path broken for another reason otherwise shows up only as the hibernation it caused.
export function keepAwake(
  wake: () => Promise<unknown>,
  { every = everyMs }: { every?: number } = {},
): KeepAwake {
  let failures = 0;
  let lastFailure = "";
  const timer = setInterval(() => {
    wake().catch((error: unknown) => {
      failures += 1;
      lastFailure = String(error);
      if (failures === 1)
        console.warn(`[e2e] the keep-awake wake failed: ${lastFailure}`);
    });
  }, every);
  return {
    stop: () => clearInterval(timer),
    get failures() {
      return failures;
    },
    get lastFailure() {
      return lastFailure;
    },
  };
}

if (import.meta.main) {
  let wakes = 0;
  const keeping = keepAwake(async () => void (wakes += 1), { every: 10 });
  execFileSync(process.execPath, [
    "-e",
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150)",
  ]);
  assert.equal(wakes, 0, "a synchronous child blocked the keep-awake wake");
  await delay(40);
  assert.ok(wakes > 0, "the keep-awake wake did not resume once the loop ran");
  keeping.stop();
  const stopped = wakes;
  await delay(40);
  assert.equal(wakes, stopped, "stop did not cancel the keep-awake wake");

  const failing = keepAwake(
    async () => {
      throw new Error("the wake was refused");
    },
    { every: 5 },
  );
  await delay(30);
  failing.stop();
  assert.ok(failing.failures > 0, "a failed wake was not counted");
  assert.match(failing.lastFailure, /the wake was refused/);
  console.log("keep-awake self-check OK");
}
