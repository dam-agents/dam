/**
 * TEST_OVERVIEW: The file driver materializes `file` contributions and keeps a
 * record of every path it wrote in its own state file. A path that a later
 * snapshot no longer carries is cleaned up by the mode it was written with: an
 * overwritten file is removed, a marked section is stripped, the top-level keys
 * it set are deleted. Files the driver never wrote are not touched, and the
 * additive yaml-fill-if-missing mode is left in place.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Contribution, DispatchContext } from "agent-runtime-api";
import { createFilePlugin } from "../../modules/runtime-channel/drivers/file-plugin.js";

let home: string;
let ctx: DispatchContext;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "file-plugin-"));
  ctx = {
    agentHome: home,
    pluginStateDir: join(home, ".state"),
    log: () => {},
  };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const driver = () => createFilePlugin().bind!("file", { impl: "file" });
const read = (rel: string) => readFileSync(join(home, rel), "utf8");

const hostsFile: Contribution = {
  kind: "file",
  path: "$HOME/.config/gh/hosts.yml",
  format: "yaml",
  mergeMode: "key-targeted",
  content: { "github.com": { user: "work", oauth_token: "platform:conn:a" } },
};
const commitIdentity: Contribution = {
  kind: "file",
  path: "$HOME/.gitconfig",
  format: "ini",
  mergeMode: "section-marker",
  content: { user: { name: "Work Bot", email: "work@example.com" } },
};
const kubeconfig: Contribution = {
  kind: "file",
  path: "$HOME/.kube/platform.yaml",
  format: "yaml",
  mergeMode: "overwrite",
  content: { apiVersion: "v1", kind: "Config" },
};

describe("file plugin", () => {
  /** TEST_SCENARIO: An agent dropping back to one GitHub account stops
   * receiving the hosts file. The key the platform set must go, and a host gh
   * or the user wrote into the same file must stay. */
  it("removes the keys it set when a key-targeted file is no longer contributed", async () => {
    mkdirSync(join(home, ".config/gh"), { recursive: true });
    writeFileSync(
      join(home, ".config/gh/hosts.yml"),
      "ghe.example.com:\n  user: me\n",
    );
    const run = driver();
    await run([hostsFile], ctx);
    expect(load(read(".config/gh/hosts.yml"))).toHaveProperty("github.com");
    await run([], ctx);
    expect(load(read(".config/gh/hosts.yml"))).toEqual({
      "ghe.example.com": { user: "me" },
    });
  });

  /** TEST_SCENARIO: When no account contributes a commit identity any more,
   * the platform's [user] block must not keep naming the old one, while the
   * agent's own git config survives. */
  it("strips the marked section when a section-marker file is no longer contributed", async () => {
    writeFileSync(join(home, ".gitconfig"), "[core]\n\teditor = vi\n");
    const run = driver();
    await run([commitIdentity], ctx);
    expect(read(".gitconfig")).toContain("Work Bot");
    await run([], ctx);
    expect(read(".gitconfig")).toBe("[core]\n\teditor = vi\n");
  });

  /** TEST_SCENARIO: A file the platform owns outright, like a kubeconfig, has
   * nothing to preserve, so it is removed. */
  it("deletes an overwritten file that is no longer contributed", async () => {
    const run = driver();
    await run([kubeconfig], ctx);
    expect(existsSync(join(home, ".kube/platform.yaml"))).toBe(true);
    await run([], ctx);
    expect(existsSync(join(home, ".kube/platform.yaml"))).toBe(false);
  });

  /** TEST_SCENARIO: The record outlives the driver instance: a pod restart
   * must still know what the previous run wrote. */
  it("remembers what it wrote across driver instances", async () => {
    await driver()([kubeconfig, commitIdentity], ctx);
    await driver()([], ctx);
    expect(existsSync(join(home, ".kube/platform.yaml"))).toBe(false);
    expect(read(".gitconfig")).toBe("");
  });

  /** TEST_SCENARIO: Only paths the driver wrote are candidates for removal. A
   * file that was already there, or that a pod wrote before the driver kept
   * records, is left as it is. */
  it("leaves files it never wrote alone", async () => {
    writeFileSync(join(home, ".gitconfig"), "[core]\n\teditor = vi\n");
    const run = driver();
    await run([kubeconfig], ctx);
    await run([], ctx);
    expect(read(".gitconfig")).toBe("[core]\n\teditor = vi\n");
  });

  /** TEST_SCENARIO: yaml-fill-if-missing only adds keys that were absent, so
   * the driver cannot tell its keys from the user's and leaves the file. */
  it("leaves a yaml-fill-if-missing file in place", async () => {
    const fill: Contribution = {
      kind: "file",
      path: "$HOME/settings.yaml",
      format: "yaml",
      mergeMode: "yaml-fill-if-missing",
      content: { theme: "dark" },
    };
    const run = driver();
    await run([fill], ctx);
    await run([], ctx);
    expect(load(read("settings.yaml"))).toEqual({ theme: "dark" });
  });

  /** TEST_SCENARIO: A path that comes back in a later snapshot is written again
   * and tracked again, so removal and re-delivery can alternate. */
  it("writes a path again after it was removed", async () => {
    const run = driver();
    await run([kubeconfig], ctx);
    await run([], ctx);
    await run([kubeconfig], ctx);
    expect(load(read(".kube/platform.yaml"))).toEqual({
      apiVersion: "v1",
      kind: "Config",
    });
  });
});
