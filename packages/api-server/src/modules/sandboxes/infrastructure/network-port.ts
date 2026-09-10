import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "./exec.js";
import {
  nftablesRuleset,
  type SandboxLink,
} from "../domain/network.js";

export interface NetworkPort {
  /** Creates the namespace and the point-to-point link, idempotently. */
  create(link: SandboxLink): Promise<void>;
  destroy(link: SandboxLink): Promise<void>;
  /** Rewrites the whole ruleset for the links that exist now. */
  applyRuleset(
    links: readonly SandboxLink[],
    ports: { gatewayPort: number; sandboxPort: number },
  ): Promise<void>;
  list(): Promise<string[]>;
}

export function createNetworkPort(): NetworkPort {
  const ip = (...args: string[]) => exec("ip", args);

  return {
    async create(link) {
      // A namespace can be *listed* and still be unusable: `ip netns add`
      // leaves the anchor file behind if the bind mount is lost, and joining
      // one of those fails with a bare EINVAL. Probing is the only way to
      // tell, and a stale anchor is recreated rather than reported — nothing
      // downstream can do anything with it either.
      const usable = await exec("ip", ["netns", "exec", link.netns, "true"])
        .then(() => true)
        .catch(() => false);
      if (!usable) {
        await ip("netns", "del", link.netns).catch(() => {});
        await ip("link", "del", link.hostInterface).catch(() => {});
        await ip("netns", "add", link.netns);
      }

      // A veth pair is created whole; if the host end is already there the
      // link survived a restart and only addressing needs re-asserting.
      const links = await exec("ip", ["-o", "link", "show"]).catch(() => "");
      if (!links.includes(`${link.hostInterface}@`)) {
        await ip("link", "del", link.hostInterface).catch(() => {});
        await ip(
          "link", "add", link.hostInterface,
          "type", "veth",
          "peer", "name", link.sandboxInterface,
        );
        await ip("link", "set", link.sandboxInterface, "netns", link.netns);
      }

      await ip(
        "addr", "replace",
        `${link.hostAddress}/${link.prefixLength}`,
        "dev", link.hostInterface,
      );
      await ip("link", "set", link.hostInterface, "up");

      const inNs = (...args: string[]) =>
        ip("netns", "exec", link.netns, "ip", ...args);
      await inNs(
        "addr", "replace",
        `${link.sandboxAddress}/${link.prefixLength}`,
        "dev", link.sandboxInterface,
      );
      await inNs("link", "set", link.sandboxInterface, "up");
      await inNs("link", "set", "lo", "up");
      // Deliberately no default route: the /30 is the whole routing table, so
      // the sandbox cannot address anything but its gateway.
    },

    async destroy(link) {
      await ip("link", "del", link.hostInterface).catch(() => {});
      await ip("netns", "del", link.netns).catch(() => {});
    },

    async applyRuleset(links, ports) {
      // nft reads its input as a file, and refuses a pipe — so the ruleset
      // goes through a real one. It is written whole and the old table is
      // dropped in the same transaction, so there is no window in which a
      // sandbox is on a half-applied ruleset.
      const path = join(tmpdir(), `dam-nft-${process.pid}.nft`);
      await writeFile(
        path,
        `table inet dam\ndelete table inet dam\n${nftablesRuleset({ links, ...ports })}`,
        { mode: 0o600 },
      );
      try {
        await exec("nft", ["-f", path]);
      } finally {
        await rm(path, { force: true });
      }
    },

    async list() {
      const out = await exec("ip", ["-json", "netns", "list"]).catch(() => "[]");
      const parsed = JSON.parse(out || "[]") as { name?: string }[];
      return parsed.flatMap((n) => (n.name ? [n.name] : []));
    },
  };
}
