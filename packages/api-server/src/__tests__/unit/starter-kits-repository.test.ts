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
  createStarterKitsRepository,
  type NamedCatalog,
} from "../../modules/starter-kits/infrastructure/kits-repository.js";

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
): CatalogSource & { reads: string[] } {
  const reads: string[] = [];
  return {
    locator,
    reads,
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
  - gitUrl: https://github.com/acme/pm-agent
    ref: v1.2.0
`,
      "kits/reviewer/kit.yaml": KIT("reviewer"),
    });
    const external = memorySource("https://github.com/acme/pm-agent#v1.2.0", {
      "kit.yaml": KIT("pm-agent"),
    });
    const repo = createStarterKitsRepository({
      appVersion: APP_VERSION,
      catalogs: [{ name: "platform", source: catalog }],
      sourceForEntry: (gitUrl, ref) => {
        expect(gitUrl).toBe("https://github.com/acme/pm-agent");
        expect(ref).toBe("v1.2.0");
        return external;
      },
    });

    const kits = await repo.list();
    expect(kits.map((k) => [k.catalog, k.kit.id, k.version, k.source])).toEqual(
      [
        ["platform", "reviewer", APP_VERSION, "/catalog"],
        [
          "platform",
          "pm-agent",
          "v1.2.0",
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
        "kits:\n  - path: kits/ok\n  - gitUrl: https://example.com/not-github\n    ref: v1\n",
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
    const repo = createStarterKitsRepository({
      appVersion: APP_VERSION,
      catalogs: [{ name: "platform", source: catalog }, exploding],
      sourceForEntry: () => {
        throw new Error("unsupported git host");
      },
    });

    expect((await repo.list()).map((k) => k.kit.id)).toEqual(["ok"]);
  });

  it("drops a kit that fails validation and keeps the rest", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml": "kits:\n  - path: bad\n  - path: good\n",
      "bad/kit.yaml": "schemaVersion: v1\nid: BAD ID\n",
      "good/kit.yaml": KIT("good"),
    });
    const repo = createStarterKitsRepository({
      appVersion: APP_VERSION,
      catalogs: [{ name: "platform", source: catalog }],
    });
    expect((await repo.list()).map((k) => k.kit.id)).toEqual(["good"]);
  });

  it("rejects entry paths that escape the catalog", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml": "kits:\n  - path: ../secrets\n",
    });
    const repo = createStarterKitsRepository({
      appVersion: APP_VERSION,
      catalogs: [{ name: "platform", source: catalog }],
    });
    expect(await repo.list()).toEqual([]);
    expect(catalog.reads).toEqual(["catalog.yaml"]);
  });

  it("serves the cached list within the ttl and reloads after it", async () => {
    const catalog = memorySource("/catalog", {
      "catalog.yaml": "kits:\n  - path: a\n",
      "a/kit.yaml": KIT("a"),
    });
    let t = 0;
    const repo = createStarterKitsRepository({
      appVersion: APP_VERSION,
      catalogs: [{ name: "platform", source: catalog }],
      ttlMs: 100,
      now: () => t,
    });
    await repo.list();
    await repo.list();
    expect(catalog.reads.filter((r) => r === "catalog.yaml")).toHaveLength(1);
    t = 101;
    await repo.list();
    expect(catalog.reads.filter((r) => r === "catalog.yaml")).toHaveLength(2);
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
    const repo = createStarterKitsRepository({
      appVersion: APP_VERSION,
      catalogs: [
        { name: "platform", source: a },
        { name: "acme", source: b },
      ],
    });
    const kits = await repo.list();
    expect(kits.map((k) => `${k.catalog}/${k.kit.id}`)).toEqual([
      "platform/shared",
      "acme/shared",
    ]);
    expect((await repo.get("acme", "shared"))?.source).toBe("/b");
    expect(await repo.get("nope", "shared")).toBeNull();
  });

  it("returns nothing when no catalog is configured", async () => {
    const repo = createStarterKitsRepository({
      catalogs: [],
      appVersion: APP_VERSION,
    });
    expect(await repo.list()).toEqual([]);
  });
});

describe("catalog sources", () => {
  it("parses GitHub repository URLs with an optional ref fragment", () => {
    expect(parseGithubRepoUrl("https://github.com/acme/kits")).toEqual({
      owner: "acme",
      repo: "kits",
    });
    expect(parseGithubRepoUrl("https://github.com/acme/kits.git#main")).toEqual(
      { owner: "acme", repo: "kits", ref: "main" },
    );
    expect(parseGithubRepoUrl("https://gitlab.com/acme/kits")).toBeNull();
    expect(parseGithubRepoUrl("/some/dir")).toBeNull();
    expect(
      parseGithubRepoUrl("https://github.com/acme/dam/tree/main/starter-kits"),
    ).toEqual({ owner: "acme", repo: "dam", ref: "main", dir: "starter-kits" });
    expect(
      parseGithubRepoUrl("https://github.com/acme/dam/tree/main/../x"),
    ).toBeNull();
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
      createCatalogSourceFromLocator("https://github.com/acme/kits#v2")
        ?.locator,
    ).toBe("https://github.com/acme/kits#v2");
    expect(
      createCatalogSourceFromLocator(
        "https://github.com/acme/dam/tree/main/starter-kits",
      )?.locator,
    ).toBe("https://github.com/acme/dam#main:starter-kits");
    expect(createCatalogSourceFromLocator("")).toBeNull();
    expect(createCatalogSourceFromLocator("/tmp/kits")?.locator).toBe(
      "/tmp/kits",
    );
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
    const repo = createStarterKitsRepository({
      appVersion: APP_VERSION,
      catalogs: [{ name: "platform", source: createLocalCatalogSource(dir) }],
    });
    const kits = await repo.list();
    expect(kits.map((k) => k.kit.id).sort()).toEqual([
      "adaevolve",
      "code-reviewer",
      "evox",
      "gepa",
      "k-search",
      "nous",
      "openevolve",
      "shinkaevolve",
    ]);
    expect(new Set(kits.map((k) => k.catalog))).toEqual(new Set(["platform"]));
    const reviewer = kits.find((k) => k.kit.id === "code-reviewer")!.kit;
    expect(reviewer.connections[0]).toMatchObject({ required: true });
    expect(reviewer.schedules.filter((s) => s.enabled)).toHaveLength(1);
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
  });
});
