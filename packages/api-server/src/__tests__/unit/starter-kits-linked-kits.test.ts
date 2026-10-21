import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { parseCatalogSeeds } from "../../modules/starter-kits/infrastructure/catalog-seeds.js";
import type { CatalogSource } from "../../modules/starter-kits/infrastructure/catalog-source.js";
import { createGitHosts } from "../../modules/starter-kits/infrastructure/git-hosts.js";
import type { RefResolution } from "../../modules/starter-kits/infrastructure/git-ref-resolver.js";
import { createLinkedKits } from "../../modules/starter-kits/infrastructure/linked-kits.js";

const SHA = "a".repeat(40);
const PINNED = "c".repeat(40);

const KIT = (id: string, extra = "") => `
schemaVersion: v1
id: ${id}
name: ${id}
description: A kit.
category: software
${extra}`;

function source(files: Record<string, string>): CatalogSource {
  return {
    locator: "memory",
    readText: async (relPath) => files[relPath] ?? null,
    readBytes: async (relPath) =>
      files[relPath] === undefined ? null : Buffer.from(files[relPath]),
  };
}

function linked(opts: {
  files?: Record<string, string>;
  resolve?: (gitUrl: string, ref?: string) => RefResolution;
}) {
  const reads: { gitUrl: string; ref: string }[] = [];
  const resolves: { gitUrl: string; ref?: string }[] = [];
  const kits = createLinkedKits({
    appVersion: "1.0.0",
    refs: {
      resolve: async (gitUrl, ref) => {
        resolves.push({ gitUrl, ...(ref ? { ref } : {}) });
        return (
          opts.resolve?.(gitUrl, ref) ?? {
            status: "resolved",
            sha: ref && /^[0-9a-f]{40}$/.test(ref) ? ref : SHA,
          }
        );
      },
    },
    scanSkills: async () => [{ name: "review", description: "Reviews." }],
    sourceForEntry: (gitUrl, ref) => {
      reads.push({ gitUrl, ref });
      return source(opts.files ?? { "kit.yaml": KIT("shared") });
    },
  });
  return { kits, reads, resolves };
}

async function refusal(promise: Promise<unknown>): Promise<TRPCError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(TRPCError);
  return err as TRPCError;
}

describe("starter kits: a kit from a link", () => {
  // TEST_SCENARIO: a teammate pastes the repository's address as GitHub shows it; the kit at the root of its default branch is read at the commit that branch points to, so what the user reviews is one exact version of the kit.
  it("reads the kit at the head of a pasted repository URL", async () => {
    const { kits, reads } = linked({});
    const kit = await kits.read("https://github.com/acme/shared-kit.git");

    expect(reads).toEqual([
      { gitUrl: "https://github.com/acme/shared-kit", ref: SHA },
    ]);
    expect(kit).toMatchObject({
      catalog: "link",
      version: SHA,
      link: { url: "https://github.com/acme/shared-kit" },
      kit: { id: "shared" },
    });
  });

  // TEST_SCENARIO: creating the agent reads the kit again at the commit the user reviewed, not at whatever the branch points to by then — a push between the preview and the click must not change what gets set up.
  it("reads the commit it is given, not the branch head", async () => {
    const { kits, reads } = linked({});
    const kit = await kits.read("https://github.com/acme/shared-kit", PINNED);
    expect(reads).toEqual([
      { gitUrl: "https://github.com/acme/shared-kit", ref: PINNED },
    ]);
    expect(kit.version).toBe(PINNED);
  });

  // TEST_SCENARIO: the install's enterprise credential reads only what an operator chose to list. A URL a user types must never make the api-server fetch an internal repository with that token and show its contents — so a link is read from public GitHub only, even on an install that has an enterprise host.
  it("refuses a link to any host but public GitHub", async () => {
    const { kits, reads } = linked({});
    for (const url of [
      "https://github.ibm.com/acme/kit",
      "https://gitlab.com/acme/kit",
      "https://github.com/acme/kit/tree/main/kits/a",
    ]) {
      const err = await refusal(kits.read(url));
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.message).toContain("https://github.com/<owner>/<repo>");
    }
    expect(reads).toEqual([]);
  });

  // TEST_SCENARIO: a kit's seed is fetched into the agent's workspace with the same reach as the kit itself, so a public kit cannot name an internal repository as its seed either.
  it("refuses a kit whose seed is not on public GitHub", async () => {
    const { kits } = linked({
      files: {
        "kit.yaml": KIT(
          "shared",
          "seed:\n  url: https://github.ibm.com/acme/internal\n",
        ),
      },
    });
    const err = await refusal(kits.read("https://github.com/acme/shared-kit"));
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toContain("https://github.ibm.com/acme/internal");
  });

  // TEST_SCENARIO: the person who pasted the link is the one who must fix it, so a refusal says what is wrong with the repository — missing kit.yaml, an invalid field — rather than a generic failure only an operator's log explains.
  it("says why a repository is not a usable kit", async () => {
    const missing = linked({ files: {} });
    const err = await refusal(
      missing.kits.read("https://github.com/acme/shared-kit"),
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("https://github.com/acme/shared-kit has no kit.yaml");

    const invalid = linked({
      files: { "kit.yaml": KIT("shared", "video: not-a-url\n") },
    });
    const bad = await refusal(
      invalid.kits.read("https://github.com/acme/shared-kit"),
    );
    expect(bad.code).toBe("BAD_REQUEST");
    expect(bad.message).toMatch(/^kit\.yaml is not a valid kit: video: /);

    const broken = linked({ files: { "kit.yaml": "id: [unclosed\n" } });
    const yaml = await refusal(
      broken.kits.read("https://github.com/acme/shared-kit"),
    );
    expect(yaml.code).toBe("BAD_REQUEST");
    expect(yaml.message).toMatch(/^kit\.yaml is not valid YAML: /);
  });

  // TEST_SCENARIO: a repository that cannot be found and one that cannot be reached right now call for different actions from the user — check the link, or try again — so they must not read the same.
  it("tells a missing repository from an unreachable one", async () => {
    const absent = linked({ resolve: () => ({ status: "absent" }) });
    const gone = await refusal(
      absent.kits.read("https://github.com/acme/private-kit"),
    );
    expect(gone.code).toBe("BAD_REQUEST");
    expect(gone.message).toContain("could not be found, or it is not public");

    const down = linked({ resolve: () => ({ status: "unreachable" }) });
    const later = await refusal(
      down.kits.read("https://github.com/acme/shared-kit"),
    );
    expect(later.code).toBe("BAD_GATEWAY");
    expect(later.message).toContain("try again");
  });

  // TEST_SCENARIO: a self-seeded kit from a link seeds the workspace from the very commit the kit was read at, as a catalog kit does, so the Kit Update that compares against that commit works for a linked kit too.
  it("pins a self-seeded kit to the commit it was read at", async () => {
    const { kits } = linked({
      files: {
        "kit.yaml": KIT(
          "shared",
          "seed:\n  self: true\nbundledSkills:\n  path: skills\n",
        ),
      },
    });
    const kit = await kits.read("https://github.com/acme/shared-kit");
    expect(kit.kit.seed).toMatchObject({
      url: "https://github.com/acme/shared-kit",
      commit: SHA,
    });
    expect(kit.skillsInKit).toEqual([
      { name: "review", description: "Reviews." },
    ]);
  });

  // TEST_SCENARIO: a catalog kit's avatar image is stored and kept by the hourly sweep because a catalog row names it; a linked kit is never stored, so storing its image would leave an orphan on every preview. The kit keeps the default avatar instead, and an avatar character still comes through.
  it("drops an avatar image but keeps an avatar character", async () => {
    const image = linked({
      files: {
        "kit.yaml": KIT("shared", "avatar:\n  path: avatar.png\n"),
        "avatar.png": "not read",
      },
    });
    const withImage = await image.kits.read(
      "https://github.com/acme/shared-kit",
    );
    expect(withImage.kit).not.toHaveProperty("avatar");

    const character = linked({
      files: { "kit.yaml": KIT("shared", "avatar: shield\n") },
    });
    const withCharacter = await character.kits.read(
      "https://github.com/acme/shared-kit",
    );
    expect(withCharacter.kit.avatar).toBe("shield");
  });

  // TEST_SCENARIO: an agent made from a link is stamped `link/<kit>@<commit>`; a configured catalog of that name would make those agents look listed in it, and its kits look like links. The install refuses the name rather than let the two meet.
  it("reserves the catalog name link", () => {
    expect(() =>
      parseCatalogSeeds(
        JSON.stringify([{ name: "link", url: "https://github.com/acme/kits" }]),
        createGitHosts(),
      ),
    ).toThrow(/reserved for kits created from a link/);
  });
});
