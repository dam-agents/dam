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
      const existing = await this.list();
      if (!existing.includes(link.netns)) await ip("netns", "add", link.netns);

      // A veth pair is created whole; if the host end is already there the
      // link survived a restart and only addressing needs re-asserting.
      const links = await exec("ip", ["-o", "link", "show"]).catch(() => "");
      if (!links.includes(`${link.hostInterface}@`)) {
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
      await exec("nft", ["-f", "-"], {
        input: `table inet dam\ndelete table inet dam\n${nftablesRuleset({ links, ...ports })}`,
      });
    },

    async list() {
      const out = await exec("ip", ["-json", "netns", "list"]).catch(() => "[]");
      const parsed = JSON.parse(out || "[]") as { name?: string }[];
      return parsed.flatMap((n) => (n.name ? [n.name] : []));
    },
  };
}
