import { aliasOrder } from "api-server-api";
import type {
  CatalogEntry,
  CatalogProvider,
} from "../../model-catalog/index.js";
import {
  codexModelCatalog,
  liteLlmModelInfo,
  openAiModelList,
} from "../domain/catalog-shapes.js";
import type { RouterExtension } from "./model-router.js";

export const CODEX_CATALOG_PATH = "/codex/models";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Codex refuses a catalog response over its body
 * limit, which the full instructions on every model exceed, so each entry
 * carries this one line and the Codex image sets the real instructions with
 * `model_instructions_file`.
 */
const CODEX_INSTRUCTIONS_STUB = "You are Codex, a coding agent.";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a harness asks for its model list as soon as it
 * starts, before a fresh machine's first listing, and Codex caches an empty
 * answer for five minutes; so a catalog request waits this long for the first
 * listing, and still-empty answers 503, which a harness retries.
 */
const FIRST_LISTING_WAIT_MS = 10_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Codex takes the first listed model as its
 * default, so the harness's home provider is listed first.
 */
const homeFirst = (
  entries: readonly CatalogEntry[],
  harness: string,
): CatalogEntry[] => {
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        aliasOrder(a.entry.alias, harness) -
          aliasOrder(b.entry.alias, harness) || a.index - b.index,
    )
    .map(({ entry }) => entry);
  return ordered;
};

const flagshipFirst = (entries: readonly CatalogEntry[]): CatalogEntry[] => {
  const lead = flagship(entries.filter((e) => e.alias === entries[0]?.alias));
  return lead ? [lead, ...entries.filter((e) => e !== lead)] : [...entries];
};

const FLAGSHIP = /^(?:.*\/)?gpt-(\d+(?:\.\d+)?)/i;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the newest GPT-5-era model, plain name over a
 * variant, to lead the list; an alphabetical listing would otherwise start
 * Codex on gpt-4-turbo, which the Responses API refuses.
 */
function flagship(entries: readonly CatalogEntry[]): CatalogEntry | undefined {
  const scored = entries.flatMap((entry) => {
    const version = FLAGSHIP.exec(entry.upstreamId)?.[1];
    return version !== undefined && Number(version) >= 5
      ? [{ entry, version: Number(version) }]
      : [];
  });
  scored.sort(
    (a, b) =>
      b.version - a.version ||
      a.entry.upstreamId.length - b.entry.upstreamId.length,
  );
  return scored[0]?.entry;
}
const CATALOG_PATHS = new Set([
  "/v1/models",
  CODEX_CATALOG_PATH,
  "/v1/model/info",
]);

export function createCatalogEndpoints(
  catalog: {
    providers(): CatalogProvider[];
    forHarness(harness: string): CatalogEntry[];
    listed?(): Promise<void>;
  },
  firstListingWaitMs = FIRST_LISTING_WAIT_MS,
): RouterExtension {
  const json = (
    res: {
      writeHead(status: number, headers: Record<string, string>): unknown;
      end(body: string): unknown;
    },
    status: number,
    body: unknown,
  ): true => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
    return true;
  };
  return {
    name: "catalog-endpoints",
    async handle({ req, res, path, harness }) {
      if (req.method !== "GET") return false;
      if (CATALOG_PATHS.has(path)) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const listed = await Promise.race([
          (catalog.listed?.() ?? Promise.resolve()).then(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), firstListingWaitMs);
          }),
        ]);
        clearTimeout(timer);
        const pending =
          catalog.forHarness(harness).length === 0 &&
          (!listed ||
            catalog.providers().some((p) => p.status === "unavailable"));
        if (pending)
          return json(res, 503, {
            error: {
              message:
                "model-router: the model catalog has not listed yet; ask again shortly",
              type: "service_unavailable",
            },
          });
      }
      const entries = homeFirst(catalog.forHarness(harness), harness);
      if (path === "/v1/models")
        return json(res, 200, openAiModelList(entries, catalog.providers()));
      if (path === CODEX_CATALOG_PATH)
        return json(
          res,
          200,
          codexModelCatalog(
            flagshipFirst(entries),
            catalog.providers(),
            CODEX_INSTRUCTIONS_STUB,
          ),
        );
      if (path === "/v1/model/info")
        return json(res, 200, liteLlmModelInfo(entries));
      if (path.startsWith("/admin/"))
        return json(res, 404, {
          error:
            "not served by the model router: Bob's admin API belongs to its own gateway",
        });
      return false;
    },
  };
}
