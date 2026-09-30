/**
 * TEST_OVERVIEW: The runtime points git at gh's credential helper once the gh
 * credentials an agent holds are on disk. It runs the setup after a snapshot is
 * applied, but only when the gh credential contributions changed since the last
 * run, never two at once, and it tries again after a failed run. A snapshot with
 * no gh credential at all leaves git alone.
 */
import { describe, expect, it } from "vitest";
import type { Contribution } from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";
import type { RuntimeEnvReader } from "../../core/runtime-env.js";
import type { RunOnceResult } from "../../core/run-once.js";
import { createGitCredentialHelperSetup } from "../../modules/git/credential-helper.js";

const envReader: RuntimeEnvReader = {
  current: () => ({ PLATFORM_GH_TOKEN_AVAILABLE: "true" }),
  ready: () => true,
};

const token: Contribution = {
  kind: "env",
  name: "GH_TOKEN",
  placeholder: "platform:conn:aaa",
};
const hostsFile = (user: string): Contribution => ({
  kind: "file",
  path: "$HOME/.config/gh/hosts.yml",
  format: "yaml",
  mergeMode: "key-targeted",
  content: { "github.com": { user } },
});
const unrelated: Contribution = {
  kind: "env",
  name: "OTHER",
  placeholder: "x",
};

function harness(
  outcome: () => RunOnceResult = () => ok({ stdout: "", stderr: "" }),
) {
  const runs: { started: number; settle: () => void }[] = [];
  const logs: string[] = [];
  const setup = createGitCredentialHelperSetup(
    envReader,
    (msg) => logs.push(msg),
    () =>
      new Promise<RunOnceResult>((resolve) => {
        runs.push({
          started: Date.now(),
          settle: () => resolve(outcome()),
        });
      }),
  );
  return {
    setup,
    runs,
    logs,
    settleAll: () => runs.forEach((r) => r.settle()),
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("createGitCredentialHelperSetup", () => {
  /** TEST_SCENARIO: A snapshot carrying no gh credential is not a reason to touch
   * git; a snapshot carrying one is. */
  it("runs for a snapshot that carries a gh credential and not otherwise", async () => {
    const h = harness();
    h.setup([unrelated]);
    await tick();
    expect(h.runs).toHaveLength(0);
    h.setup([unrelated, token]);
    await tick();
    expect(h.runs).toHaveLength(1);
  });

  /** TEST_SCENARIO: An event-only delivery re-applies the same snapshot. The
   * setup already ran for it, so nothing spawns. */
  it("skips a snapshot whose gh credentials are unchanged", async () => {
    const h = harness();
    h.setup([token]);
    await tick();
    h.settleAll();
    await tick();
    h.setup([token, unrelated]);
    await tick();
    expect(h.runs).toHaveLength(1);
  });

  /** TEST_SCENARIO: A second account lands as gh's hosts file; that is a change
   * of gh credentials and the setup runs again. */
  it("runs again when the hosts file changes", async () => {
    const h = harness();
    h.setup([hostsFile("work")]);
    await tick();
    h.settleAll();
    await tick();
    h.setup([hostsFile("personal")]);
    await tick();
    expect(h.runs).toHaveLength(2);
  });

  /** TEST_SCENARIO: Two deliveries close together must not rewrite the git config
   * at the same time; the second run starts after the first settles. */
  it("lets one run finish before the next starts", async () => {
    const h = harness();
    h.setup([hostsFile("work")]);
    h.setup([hostsFile("personal")]);
    await tick();
    expect(h.runs).toHaveLength(1);
    h.runs[0]!.settle();
    await tick();
    await tick();
    expect(h.runs).toHaveLength(2);
  });

  /** TEST_SCENARIO: A failed setup is logged and forgotten, so the next delivery
   * of the same credentials tries again instead of leaving git unconfigured. */
  it("retries the same credentials after a failure", async () => {
    let failing = true;
    const h = harness(() =>
      failing
        ? err({ kind: "exited", code: 1, stderr: "not logged in", stdout: "" })
        : ok({ stdout: "", stderr: "" }),
    );
    h.setup([token]);
    await tick();
    h.settleAll();
    await tick();
    await tick();
    expect(h.logs).toHaveLength(1);
    failing = false;
    h.setup([token]);
    await tick();
    expect(h.runs).toHaveLength(2);
  });
});
