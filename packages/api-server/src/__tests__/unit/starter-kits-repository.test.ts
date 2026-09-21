import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CatalogSource } from "../../modules/starter-kits/infrastructure/catalog-source.js";
import {
  createCatalogSourceFromLocator,
  createGithubCatalogSource,
  createLocalCatalogSource,
  parseGithubRepoUrl,
} from "../../modules/starter-kits/infrastructure/catalog-source.js";
import {
  createCatalogRefresh,
  type CatalogRefreshDeps,
  type NamedCatalog,
} from "../../modules/starter-kits/infrastructure/catalog-refresh.js";
import { parseCatalogSeeds } from "../../modules/starter-kits/infrastructure/catalog-seeds.js";
import type { RefResolution } from "../../modules/starter-kits/infrastructure/git-ref-resolver.js";
import { createStarterKitsRepository } from "../../modules/starter-kits/infrastructure/kits-repository.js";
import type {
  ResolvedCatalogRepository,
  ResolvedKitRow,
} from "../../modules/starter-kits/infrastructure/resolved-catalog-repository.js";

const SHA = "a".repeat(40);

function memoryResolved(): ResolvedCatalogRepository {
  const rows = new Map<string, ResolvedKitRow>();
  return {
    list: async () => [...rows.values()],
    get: async (catalog, kitId) => rows.get(`${catalog}/${kitId}`) ?? null,
    upsert: async (next) => {
      for (const row of next) rows.set(`${row.catalog}/${row.kitId}`, row);
    },
    replaceCatalog: async (catalog, next) => {
      for (const key of [...rows.keys()])
        if (key.startsWith(`${catalog}/`)) rows.delete(key);
      for (const row of next) rows.set(`${catalog}/${row.kitId}`, row);
    },
  };
}

function harness(
  catalogs: NamedCatalog[],
  opts: {
    resolve?: (gitUrl: string, ref?: string) => Promise<string | RefResolution>;
    scanSkills?: CatalogRefreshDeps["scanSkills"];
    sourceForEntry?: CatalogRefreshDeps["sourceForEntry"];
  } = {},
) {
  const resolved = memoryResolved();
  const refresh = createCatalogRefresh({
    catalogs,
    repo: resolved,
    appVersion: APP_VERSION,
    refs: {
      resolve: async (gitUrl: string, ref?: string) => {
        const answer = await (opts.resolve ?? (async () => SHA))(gitUrl, ref);
        return typeof answer === "string"
          ? ({ status: "resolved", sha: answer } as const)
          : answer;
      },
    },
    scanSkills: opts.scanSkills ?? (async () => []),
    ...(opts.sourceForEntry ? { sourceForEntry: opts.sourceForEntry } : {}),
  });
  return { refresh, repo: createStarterKitsRepository({ resolved }) };
}

const APP_VERSION = "1.4.2";

const KIT = (id: string, extra = "") => `
schemaVersion: v1
id: ${id}
name: ${id}
description: A kit.
category: software
${extra}`;

function memorySource(
  locator: string,
  files: Record<string, string>,
): CatalogSource & { reads: string[]; files: Record<string, string> } {
  const reads: string[] = [];
  return {
    locator,
    reads,
    files,
    async readText(relPath) {
      reads.push(relPath);
      return files[relPath] ?? null;
    },
  };
}

describe("starter kits repository", () => {
  it("loads inline kits and pinned external kits from the catalog", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml": `
kits:
  - path: kits/reviewer
  - url: https://github.com/acme/pm-agent
    ref: v1.2.0
`,
      "kits/reviewer/kit.yaml": KIT("reviewer"),
    });
    const external = memorySource("https://github.com/acme/pm-agent#v1.2.0", {
      "kit.yaml": KIT("pm-agent"),
    });
    const { refresh, repo } = harness([{ name: "platform", source: catalog }], {
      resolve: async (gitUrl, ref) => {
        expect(gitUrl).toBe("https://github.com/acme/pm-agent");
        expect(ref).toBe("v1.2.0");
        return SHA;
      },
      sourceForEntry: () => external,
    });
    await refresh.run();

    const kits = await repo.list();
    expect(kits.map((k) => [k.catalog, k.kit.id, k.version, k.source])).toEqual(
      [
        ["platform", "reviewer", APP_VERSION, "/catalog"],
        [
          "platform",
          "pm-agent",
          SHA,
          "https://github.com/acme/pm-agent#v1.2.0",
        ],
      ],
    );
    expect((await repo.get("platform", "pm-agent"))?.kit.name).toBe("pm-agent");
    expect(await repo.get("platform", "nope")).toBeNull();
  });

  it("keeps the listing when one entry throws, and when one catalog throws", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml":
        "kits:\n  - path: kits/ok\n  - url: https://example.com/not-github\n    ref: v1\n",
      "kits/ok/kit.yaml": KIT("ok"),
    });
    const exploding: NamedCatalog = {
      name: "broken",
      source: {
        locator: "/broken",
        readText: () => {
          throw new Error("network down");
        },
      },
    };
    const { refresh, repo } = harness(
      [{ name: "platform", source: catalog }, exploding],
      {
        sourceForEntry: () => {
          throw new Error("unsupported git host");
        },
      },
    );
    await refresh.run();

    expect((await repo.list()).map((k) => k.kit.id)).toEqual(["ok"]);
  });

  // TEST_SCENARIO: a kit that lives in the code it seeds says `self`, and the resolved row must name that repository at the very commit the kit was read from. Resolving the two separately would let the definition and the code drift by a push.
  it("seeds a self-referencing kit from its own repository at its own commit", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml":
        "kits:\n  - url: https://github.com/acme/toolkit\n    ref: main\n",
    });
    const { refresh, repo } = harness([{ name: "platform", source: catalog }], {
      resolve: async () => SHA,
      sourceForEntry: () =>
        memorySource("https://github.com/acme/toolkit", {
          "kit.yaml": KIT("toolkit", "seed:\n  self: true\n"),
        }),
    });
    await refresh.run();

    const loaded = await repo.get("platform", "toolkit");
    expect(loaded?.kit.seed?.url).toBe("https://github.com/acme/toolkit");
    expect(loaded?.kit.seed?.commit).toBe(SHA);
    expect(loaded?.version).toBe(SHA);
  });

  it("pins a kit's seed ref to the commit it resolved to", async () => {
    const SEED_SHA = "b".repeat(40);
    const catalog = memorySource("/catalog", {
      "catalog.yaml": "kits:\n  - path: a\n",
      "a/kit.yaml": KIT(
        "a",
        "seed:\n  url: https://github.com/acme/def\n  ref: main\n",
      ),
    });
    const { refresh, repo } = harness([{ name: "platform", source: catalog }], {
      resolve: async (_url, ref) => (ref === "main" ? SEED_SHA : SHA),
    });
    await refresh.run();

    const loaded = await repo.get("platform", "a");
    expect(loaded?.kit.seed?.commit).toBe(SEED_SHA);
    expect(loaded?.kit.seed?.ref).toBe("main");
  });

  it("drops a kit that fails validation and keeps the rest", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml": "kits:\n  - path: bad\n  - path: good\n",
      "bad/kit.yaml": "schemaVersion: v1\nid: BAD ID\n",
      "good/kit.yaml": KIT("good"),
    });
    const { refresh, repo } = harness([{ name: "platform", source: catalog }]);
    await refresh.run();
    expect((await repo.list()).map((k) => k.kit.id)).toEqual(["good"]);
  });

  // TEST_SCENARIO: a kit that was fine and then published a kit.yaml the schema rejects is withdrawn, not frozen — only an entry the refresh could not read at all keeps its stored row.
  it("prunes a stored kit once its kit.yaml is rejected, even beside unchanged kits", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml": "kits:\n  - path: a\n  - path: b\n",
      "a/kit.yaml": KIT("a"),
      "b/kit.yaml": KIT("b"),
    });
    const { refresh, repo } = harness([{ name: "platform", source: catalog }]);
    await refresh.run();
    catalog.files["b/kit.yaml"] = "schemaVersion: v1\nid: BAD ID\n";
    await refresh.run();
    expect((await repo.list()).map((k) => k.kit.id)).toEqual(["a"]);
  });

  it("rejects entry paths that escape the catalog", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml": "kits:\n  - path: ../secrets\n",
    });
    const { refresh, repo } = harness([{ name: "platform", source: catalog }]);
    await refresh.run();
    expect(await repo.list()).toEqual([]);
    expect(catalog.reads).toEqual(["catalog.yaml"]);
  });

  // TEST_SCENARIO: the refresh must tell an outage from a withdrawal. A source that cannot answer keeps every stored row, because the kits are probably still there; a source that answers "no such file" has withdrawn that kit, and holding it would serve a kit nobody offers any more.
  it("holds the catalog through an outage and prunes a kit the source has withdrawn", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml": "kits:\n  - path: a\n  - path: b\n",
      "a/kit.yaml": KIT("a"),
      "b/kit.yaml": KIT("b"),
    });
    const { refresh, repo } = harness([{ name: "platform", source: catalog }]);
    await refresh.run();
    expect((await repo.list()).map((k) => k.kit.id)).toEqual(["a", "b"]);

    const readText = catalog.readText.bind(catalog);
    catalog.readText = async (relPath: string) => {
      if (relPath === "b/kit.yaml") throw new Error("registry unreachable");
      return readText(relPath);
    };
    await refresh.run();
    expect((await repo.list()).map((k) => k.kit.id)).toEqual(["a", "b"]);

    catalog.readText = readText;
    delete catalog.files["b/kit.yaml"];
    await refresh.run();
    expect((await repo.list()).map((k) => k.kit.id)).toEqual(["a"]);
  });

  // TEST_SCENARIO: a ref that no longer exists is the author retiring that entry, and it must prune like any other withdrawal. Treating it as an outage instead would hold the catalog's prune for good, so every kit the author later removed would stay listed and appliable at its old pin.
  it("prunes an entry whose ref is gone but holds one it could not reach", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml":
        "kits:\n  - path: a\n  - url: https://github.com/acme/b\n",
      "a/kit.yaml": KIT("a"),
    });
    const remote = memorySource("https://github.com/acme/b", {
      "kit.yaml": KIT("b"),
    });
    let outcome: RefResolution = { status: "resolved", sha: SHA };
    const { refresh, repo } = harness([{ name: "platform", source: catalog }], {
      resolve: async (gitUrl) =>
        gitUrl === "https://github.com/acme/b"
          ? outcome
          : ({ status: "resolved", sha: SHA } as const),
      sourceForEntry: () => remote,
    });
    await refresh.run();
    expect((await repo.list()).map((k) => k.kit.id).sort()).toEqual(["a", "b"]);

    outcome = { status: "unreachable" };
    await refresh.run();
    expect((await repo.list()).map((k) => k.kit.id).sort()).toEqual(["a", "b"]);

    outcome = { status: "absent" };
    await refresh.run();
    expect((await repo.list()).map((k) => k.kit.id)).toEqual(["a"]);
  });

  // TEST_SCENARIO: the stored row is what an apply clones, so it is written pinned or not written at all. A seed whose ref cannot be resolved must leave the previous pinned row standing, never overwrite it with an unpinned one.
  it("keeps the stored row when a seed ref will not resolve", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml": "kits:\n  - path: a\n",
      "a/kit.yaml": KIT(
        "a",
        "seed:\n  url: https://github.com/acme/toolkit\n  ref: main\n",
      ),
    });
    const SEED_SHA = "b".repeat(40);
    let seed: RefResolution = { status: "resolved", sha: SEED_SHA };
    const { refresh, repo } = harness([{ name: "platform", source: catalog }], {
      resolve: async (gitUrl) =>
        gitUrl === "https://github.com/acme/toolkit"
          ? seed
          : ({ status: "resolved", sha: SHA } as const),
    });
    await refresh.run();
    expect((await repo.list())[0]!.kit.seed?.commit).toBe(SEED_SHA);

    seed = { status: "unreachable" };
    await refresh.run();
    const after = await repo.list();
    expect(after).toHaveLength(1);
    expect(after[0]!.kit.seed?.commit).toBe(SEED_SHA);
  });

  it("keeps a kit's install command from any catalog", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml":
        "kits:\n  - path: kits/local\n  - url: https://github.com/acme/remote\n    ref: v1\n",
      "kits/local/kit.yaml": KIT("local", "install:\n  command: echo hi\n"),
    });
    const remote = memorySource("https://github.com/acme/remote#v1", {
      "kit.yaml": KIT("remote", "install:\n  command: echo hi\n"),
    });
    const { refresh, repo } = harness([{ name: "platform", source: catalog }], {
      sourceForEntry: () => remote,
    });
    await refresh.run();
    const kits = await repo.list();
    expect(kits.map((k) => k.kit.id).sort()).toEqual(["local", "remote"]);
    expect(kits.map((k) => k.kit.install?.command)).toEqual([
      "echo hi",
      "echo hi",
    ]);
  });

  it("replaces a catalog's kits on each refresh", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml": "kits:\n  - path: a\n",
      "a/kit.yaml": KIT("a"),
      "b/kit.yaml": KIT("b"),
    });
    const { refresh, repo } = harness([{ name: "platform", source: catalog }]);
    await refresh.run();
    expect((await repo.list()).map((k) => k.kit.id)).toEqual(["a"]);

    catalog.files["catalog.yaml"] = "kits:\n  - path: b\n";
    await refresh.run();
    expect((await repo.list()).map((k) => k.kit.id)).toEqual(["b"]);
  });

  it("reads several catalogs and keeps same-id kits apart by catalog", async () => {
    const a = memorySource("/a", {
      "catalog.yaml": "kits:\n  - path: k\n",
      "k/kit.yaml": KIT("shared"),
    });
    const b = memorySource("/b", {
      "catalog.yaml": "kits:\n  - path: k\n",
      "k/kit.yaml": KIT("shared"),
    });
    const { refresh, repo } = harness([
      { name: "platform", source: a },
      { name: "acme", source: b },
    ]);
    await refresh.run();
    const kits = await repo.list();
    expect(kits.map((k) => `${k.catalog}/${k.kit.id}`)).toEqual([
      "platform/shared",
      "acme/shared",
    ]);
    expect((await repo.get("acme", "shared"))?.source).toBe("/b");
    expect(await repo.get("nope", "shared")).toBeNull();
  });

  it("returns nothing when no catalog is configured", async () => {
    const { refresh, repo } = harness([]);
    await refresh.run();
    expect(await repo.list()).toEqual([]);
  });
});

describe("catalog sources", () => {
  // TEST_SCENARIO: a version is written in `ref` and nowhere else. A URL that carries one is refused rather than read at the default branch, because pinning a version and silently getting the tip is the failure nobody notices.
  it("reads a plain repository URL and refuses one carrying a version", () => {
    expect(parseGithubRepoUrl("https://github.com/acme/kits")).toEqual({
      owner: "acme",
      repo: "kits",
    });
    expect(parseGithubRepoUrl("https://github.com/acme/kits.git")).toEqual({
      owner: "acme",
      repo: "kits",
    });
    expect(parseGithubRepoUrl("https://github.com/acme/kits#main")).toBeNull();
    expect(
      parseGithubRepoUrl("https://github.com/acme/dam/tree/main/starter-kits"),
    ).toBeNull();
    expect(parseGithubRepoUrl("https://gitlab.com/acme/kits")).toBeNull();
    expect(parseGithubRepoUrl("/some/dir")).toBeNull();
  });

  it("reads under the directory a tree URL names", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response("kits: []");
    }) as typeof fetch;
    const src = createGithubCatalogSource(
      "https://github.com/acme/dam",
      "main",
      fetchImpl,
      "starter-kits",
    );
    expect(await src.readText("catalog.yaml")).toBe("kits: []");
    expect(urls).toEqual([
      "https://raw.githubusercontent.com/acme/dam/main/starter-kits/catalog.yaml",
    ]);
    expect(src.locator).toBe("https://github.com/acme/dam#main:starter-kits");
  });

  it("resolves a locator into the right source kind", () => {
    expect(
      createCatalogSourceFromLocator(
        "https://github.com/acme/kits",
        "url",
        "v2",
      )?.source.locator,
    ).toBe("https://github.com/acme/kits#v2");
    expect(
      createCatalogSourceFromLocator(
        "https://github.com/acme/dam",
        "url",
        "main",
        "starter-kits",
      )?.source.locator,
    ).toBe("https://github.com/acme/dam#main:starter-kits");
    expect(createCatalogSourceFromLocator("", "url")).toBeNull();
    expect(
      createCatalogSourceFromLocator(
        "https://github.com/acme/kits",
        "url",
        "v2",
      )?.gitUrl,
    ).toBe("https://github.com/acme/kits");
    expect(
      createCatalogSourceFromLocator("/tmp/kits", "path")?.source.locator,
    ).toBe("/tmp/kits");
  });

  // TEST_SCENARIO: a url this reader turns down must never be retried as a directory path. A missing directory reports every file absent, and the refresh reads absence as the author withdrawing the kits — so the guard against a version in the url would be what empties the catalog it guards.
  it("refuses a url it cannot serve instead of reading it as a directory", () => {
    for (const url of [
      "https://github.com/acme/kits#v2",
      "https://github.com/acme/kits/tree/v2/sub",
      "https://gitlab.com/acme/kits",
    ]) {
      expect(createCatalogSourceFromLocator(url, "url")).toBeNull();
      expect(() =>
        parseCatalogSeeds(JSON.stringify([{ name: "curated", url }])),
      ).toThrow(/cannot serve/);
    }
  });

  it("reads raw files from GitHub at the pinned ref and treats 404 as absent", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return String(url).endsWith("/missing.yaml")
        ? new Response(null, { status: 404 })
        : new Response("hello");
    }) as typeof fetch;
    const src = createGithubCatalogSource(
      "https://github.com/acme/kits",
      "v1",
      fetchImpl,
    );
    expect(await src.readText("./kits/a/kit.yaml")).toBe("hello");
    expect(await src.readText("missing.yaml")).toBeNull();
    expect(await src.readText("../etc/passwd")).toBeNull();
    expect(urls).toEqual([
      "https://raw.githubusercontent.com/acme/kits/v1/kits/a/kit.yaml",
      "https://raw.githubusercontent.com/acme/kits/v1/missing.yaml",
    ]);
  });

  it("refuses to read outside a local catalog directory", async () => {
    const src = createLocalCatalogSource("/nonexistent-catalog-dir");
    expect(await src.readText("../../etc/passwd")).toBeNull();
    expect(await src.readText("catalog.yaml")).toBeNull();
  });
});

describe("the shipped proof-of-concept catalog", () => {
  it("validates and lists its kits", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dir = path.resolve(here, "../../../../../helm/starter-kits");
    const { refresh, repo } = harness([
      { name: "platform", source: createLocalCatalogSource(dir) },
    ]);
    await refresh.run();
    const kits = await repo.list();
    expect(kits.map((k) => k.kit.id).sort()).toEqual([
      "adaevolve",
      "evox",
      "gepa",
      "k-search",
      "nous",
      "openevolve",
      "shinkaevolve",
    ]);
    expect(new Set(kits.map((k) => k.catalog))).toEqual(new Set(["platform"]));
    // TEST_SCENARIO: every kit the chart still ships brings its own image. The wiki toolkits are the ones that did not, and they now live in their own repositories, offered through the curated catalog.
    expect(kits.every((k) => k.kit.image !== undefined)).toBe(true);
    expect(kits.some((k) => k.kit.knowledgeBase !== undefined)).toBe(false);
    expect(kits.find((k) => k.kit.id === "nous")!.kit.image?.ref).toMatch(
      /^quay\.io\/dam-agents\/nous(:|$)/,
    );
    expect(kits.find((k) => k.kit.id === "nous")!.kit.resources).toMatchObject({
      cpu: "2",
      memory: "4Gi",
      storage: "10Gi",
    });
    expect(
      kits.find((k) => k.kit.id === "openevolve")!.kit.resources,
    ).toMatchObject({ storage: "5Gi" });
    expect(kits.every((k) => k.kit.onboarding === false)).toBe(true);
  });
});
