import { TRPCError } from "@trpc/server";
import { LINKED_KIT_CATALOG } from "api-server-api";

import { getLogger } from "../../../core/logger.js";
import type { CatalogSource } from "./catalog-source.js";
import {
  createKitResolver,
  type KitFailure,
  type KitResolverDeps,
} from "./catalog-refresh.js";
import { createGitHosts } from "./git-hosts.js";
import type { ResolvedKitRow } from "./resolved-catalog-repository.js";

export type LinkedKit = Omit<ResolvedKitRow, "kitId"> & {
  link: { url: string };
};

export interface LinkedKits {
  read(url: string, commit?: string): Promise<LinkedKit>;
}

const PUBLIC_ONLY = createGitHosts();

const NO_CATALOG_FILES: CatalogSource = {
  locator: LINKED_KIT_CATALOG,
  readText: async () => null,
  readBytes: async () => null,
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: A Linked Kit — one kit read straight from the
 * repository a user pasted, with no catalog and no admin in between. It is
 * resolved exactly as a catalog entry is, as the only entry of a catalog named
 * `link` that is never stored: the user sees what the kit sets up at the
 * commit the link resolved to, and creating the agent reads that same commit
 * again rather than trusting what the browser sends back. Only public GitHub
 * is read, for the kit and its seed alike — the install's enterprise
 * credential is never spent on a URL a user typed. A kit's avatar image is not
 * stored, because nothing would ever sweep it.
 */
export function createLinkedKits(
  deps: Omit<KitResolverDeps, "avatar">,
): LinkedKits {
  const resolver = createKitResolver(deps);
  return {
    async read(url, commit) {
      const repo = PUBLIC_ONLY.locate(url);
      if (!repo)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `not a link to a kit: ${url} (paste a public https://github.com/<owner>/<repo> URL)`,
        });
      const result = await resolver
        .resolve(
          {
            name: LINKED_KIT_CATALOG,
            source: NO_CATALOG_FILES,
            gitUrl: repo.gitUrl,
            ...(commit ? { ref: commit } : {}),
            entryHosts: PUBLIC_ONLY,
          },
          { path: "." },
        )
        .catch((err: unknown): KitFailure => {
          const message = err instanceof Error ? err.message : String(err);
          return err instanceof Error && err.name === "YAMLException"
            ? {
                kind: "rejected",
                reason: `kit.yaml is not valid YAML: ${message}`,
              }
            : {
                kind: "unreadable",
                reason: `the kit could not be read: ${message}`,
              };
        });
      if ("kind" in result) {
        getLogger().info(
          { url: repo.gitUrl, commit, reason: result.reason },
          "starter kits: a linked kit could not be read",
        );
        throw new TRPCError({
          code: result.kind === "rejected" ? "BAD_REQUEST" : "BAD_GATEWAY",
          message: result.reason,
        });
      }
      const { kitId: _id, ...loaded } = result;
      return { ...loaded, link: { url: repo.gitUrl } };
    },
  };
}
