import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "./exec.js";
import {
  nftablesRuleset,
  SANDBOX_NETNS_RULESET,
  type SandboxLink,
} from "../domain/network.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Creates and tears down the per-agent namespace
 * and link, and writes the node's whole nftables ruleset. The ruleset is
 * rendered whole and swapped in one transaction rather than patched per agent:
 * a partial ruleset is the one failure mode that silently opens egress. A
 * namespace can be listed and still be unusable — the anchor file outlives a
 * lost bind mount — so it is probed and recreated rather than trusted.
 */
export interface NetworkPort {
  create(link: SandboxLink): Promise<boolean>;
  destroy(link: SandboxLink): Promise<void>;
  destroyNetns(netns: string): Promise<void>;
  applyRuleset(
    links: readonly SandboxLink[],
    ports: { gatewayPort: number },
  ): Promise<void>;
  list(): Promise<string[]>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Builds an agent's namespace and the one link into
 * it, and says whether it had to.
 *
 * Both ends are checked, not just the host's: a pair whose host side exists
 * while its sandbox side is missing from the namespace cannot be addressed, and
 * a pass that trusts the host side alone fails forever on a device it never
 * rebuilds. Converging means arriving at the whole link from whatever is
 * actually there.
 *
 * Whether it rebuilt is the caller's business because a sandbox already running
 * read its address when it booted: repairing the link under it leaves a network
 * only the kernel can see, so the sandbox has to go and be started again.
 */
export function createNetworkPort(): NetworkPort {
  const ip = (...args: string[]) => exec("ip", args);

  async function nft(ruleset: string, netns?: string): Promise<void> {
    const path = join(tmpdir(), `dam-nft-${randomUUID()}.nft`);
    await writeFile(path, ruleset, { mode: 0o600 });
    try {
      if (netns) await exec("ip", ["netns", "exec", netns, "nft", "-f", path]);
      else await exec("nft", ["-f", path]);
    } finally {
      await rm(path, { force: true });
    }
  }

  return {
    async create(link) {
      const usable = await exec("ip", ["netns", "exec", link.netns, "true"])
        .then(() => true)
        .catch(() => false);
      if (!usable) {
        await ip("netns", "del", link.netns).catch(() => {});
        await ip("link", "del", link.hostInterface).catch(() => {});
        await ip("netns", "add", link.netns);
      }

      const hostLinks = await exec("ip", ["-o", "link", "show"]).catch(
        () => "",
      );
      const nsLinks = await exec("ip", [
        "netns",
        "exec",
        link.netns,
        "ip",
        "-o",
        "link",
        "show",
      ]).catch(() => "");
      const paired =
        hostLinks.includes(`${link.hostInterface}@`) &&
        new RegExp(`\\b${link.sandboxInterface}[@:]`).test(nsLinks);
      if (!paired) {
        await ip("link", "del", link.hostInterface).catch(() => {});
        await ip(
          "netns",
          "exec",
          link.netns,
          "ip",
          "link",
          "del",
          link.sandboxInterface,
        ).catch(() => {});
        await ip(
          "link",
          "add",
          link.hostInterface,
          "type",
          "veth",
          "peer",
          "name",
          link.sandboxInterface,
        );
        await ip("link", "set", link.sandboxInterface, "netns", link.netns);
      }

      await ip(
        "addr",
        "replace",
        `${link.hostAddress}/${link.prefixLength}`,
        "dev",
        link.hostInterface,
      );
      await ip("link", "set", link.hostInterface, "up");

      const inNs = (...args: string[]) =>
        ip("netns", "exec", link.netns, "ip", ...args);
      await inNs(
        "addr",
        "replace",
        `${link.sandboxAddress}/${link.prefixLength}`,
        "dev",
        link.sandboxInterface,
      );
      await inNs("link", "set", link.sandboxInterface, "up");
      await inNs("link", "set", "lo", "up");
      await nft(SANDBOX_NETNS_RULESET, link.netns);
      return !paired;
    },

    async destroy(link) {
      await ip("link", "del", link.hostInterface).catch(() => {});
      await ip("netns", "del", link.netns).catch(() => {});
    },

    async destroyNetns(netns) {
      await ip("netns", "del", netns).catch(() => {});
    },

    async applyRuleset(links, ports) {
      await nft(
        `table inet dam\ndelete table inet dam\n${nftablesRuleset({ links, ...ports })}`,
      );
    },

    async list() {
      const out = await exec("ip", ["-json", "netns", "list"]).catch(
        () => "[]",
      );
      const parsed = JSON.parse(out || "[]") as { name?: string }[];
      return parsed.flatMap((n) => (n.name ? [n.name] : []));
    },
  };
}
