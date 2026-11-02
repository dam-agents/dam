import type { StarterKitView } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type { KitAmbiguousError, KitNotFoundError } from "./errors.js";

const GITHUB_REPO =
  /^(?:https:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the repository a Kit Ref names when it is a
 * link to a kit outside the catalogs, as the web app's link form takes it:
 * only a repository's own address, so a link into a branch or a folder is
 * not quietly read at the default branch.
 */
export function kitLinkUrl(ref: string): string | null {
  const match = GITHUB_REPO.exec(ref.trim());
  if (!match) return null;
  const [, owner, repo] = match;
  if (repo === "." || repo === "..") return null;
  return `https://github.com/${owner}/${repo}`;
}

export function kitRefOf(
  kit: Pick<StarterKitView, "catalog" | "id" | "link">,
  catalogKits: readonly Pick<StarterKitView, "catalog" | "id">[],
): string {
  if (kit.link) return kit.link.url;
  const shared = catalogKits.filter((k) => k.id === kit.id).length > 1;
  return shared ? `${kit.catalog}/${kit.id}` : kit.id;
}

export function findCatalogKit(
  kits: readonly StarterKitView[],
  ref: string,
): Result<StarterKitView, KitNotFoundError | KitAmbiguousError> {
  const slash = ref.indexOf("/");
  const matches =
    slash > 0
      ? kits.filter(
          (k) =>
            k.catalog === ref.slice(0, slash) && k.id === ref.slice(slash + 1),
        )
      : kits.filter((k) => k.id === ref);
  if (matches.length === 1) return ok(matches[0]!);
  if (matches.length === 0) return err({ kind: "kit-not-found", ref });
  return err({
    kind: "kit-ambiguous",
    ref,
    matches: matches.map((k) => `${k.catalog}/${k.id}`),
  });
}

const FULL_SHA = /^[0-9a-f]{40}$/;

export function shortKitVersion(version: string): string {
  return FULL_SHA.test(version) ? version.slice(0, 9) : version;
}

export function parseAgentKitRef(
  ref: string,
): { catalog: string; kit: string; version: string | null } | null {
  const at = ref.lastIndexOf("@");
  const path = at > 0 ? ref.slice(0, at) : ref;
  const slash = path.indexOf("/");
  if (slash <= 0 || slash === path.length - 1) return null;
  return {
    catalog: path.slice(0, slash),
    kit: path.slice(slash + 1),
    version: at > 0 ? ref.slice(at + 1) : null,
  };
}
