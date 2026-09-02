import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { securityLog } from "../../../core/security-log.js";
import { getLogger } from "../../../core/logger.js";
import {
  tokenize,
  type AnySnapshotManifest,
} from "agent-runtime-api/kb-snapshot";
import { querySearchIndex } from "../domain/legacy-search-index.js";
import { querySegments } from "../domain/segmented-query.js";
import { extractSnippets } from "../domain/snippets.js";
import type { KbShareRow } from "../domain/types.js";
import {
  GREP_DEADLINE_MS,
  GrepDeadlineError,
  GrepPatternError,
  runGlobFilterWorker,
  runGrepWorker,
  type GrepInputFile,
} from "./grep-worker.js";
import { QueryBusyError, type QueryLimits } from "./limits.js";
import {
  READ_DEFAULT_MAX_CHARS,
  type SnapshotReader,
} from "./snapshot-reader.js";
import { resolveAccessibleShares, type TokenAuthDeps } from "./token-auth.js";

const LIST_DOCUMENTS_MAX = 2000;
const SEARCH_TOP_DOCS = 5;
const SNIPPET_CONTEXT_LINES = 2;
const SNIPPETS_PER_DOC = 2;
const GREP_SCAN_BUDGET_BYTES = 20 * 1024 * 1024;
const FALLBACK_GUIDE =
  "A snapshot of a knowledge base. Look for an index or catalog file (list_documents) to navigate its content.";

export interface KbShareMcpAppDeps extends TokenAuthDeps {
  reader: SnapshotReader;
  agentName: (agentId: string) => Promise<string>;
  incrementQueryCount: (rowId: string) => Promise<void>;
  markShareDirty?: (agentId: string) => Promise<void>;
  limits: QueryLimits;
  grepDeadlineMs?: number;
}

interface ToolContent {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

function textResult(text: string): ToolContent {
  return { content: [{ type: "text", text }] };
}

function errorResult(text: string): ToolContent {
  return { content: [{ type: "text", text }], isError: true };
}

function staleness(manifest: AnySnapshotManifest): string {
  return `— snapshot from ${manifest.createdAt}`;
}

function unexpectedError(tool: string, err: unknown): ToolContent {
  getLogger().error(
    { err: err instanceof Error ? err.message : String(err), tool },
    "kb_share.query_error",
  );
  return errorResult(
    "the knowledge base could not be queried right now — retry shortly",
  );
}

export function createKbShareMcpApp(deps: KbShareMcpAppDeps): Hono {
  const grepDeadlineMs = deps.grepDeadlineMs ?? GREP_DEADLINE_MS;
  const healRequested = new Set<string>();
  function requestIndexHeal(row: KbShareRow, snapshotId: string): void {
    if (healRequested.has(snapshotId)) return;
    healRequested.add(snapshotId);
    getLogger().warn(
      { agentId: row.agentId, snapshotId },
      "kb_share.index_unreadable",
    );
    void deps.markShareDirty?.(row.agentId).catch(() => {});
  }
  function recordQuery(row: KbShareRow, tool: string): void {
    void deps.incrementQueryCount(row.id).catch(() => {});
    securityLog("info", "kb_share.query", {
      category: "resource",
      actor: row.id,
      actorKind: "external",
      surface: "mcp",
      agentId: row.agentId,
      result: "success",
      detail: { tool },
    });
  }

  async function resolveManifest(
    shares: Map<string, KbShareRow>,
    kb: string,
  ): Promise<
    | { ok: true; row: KbShareRow; manifest: AnySnapshotManifest }
    | { ok: false; error: ToolContent }
  > {
    const row = shares.get(kb);
    if (!row) {
      return { ok: false, error: errorResult(`unknown knowledge base: ${kb}`) };
    }
    if (!row.snapshotId || !row.snapshotManifestKey) {
      return {
        ok: false,
        error: errorResult(
          "this knowledge base has no published snapshot yet — ask its owner to publish",
        ),
      };
    }
    const manifest = await deps.reader.getManifest(
      row.snapshotManifestKey,
      row.snapshotId,
    );
    if (!manifest) {
      return {
        ok: false,
        error: errorResult(
          "the published snapshot is unavailable right now — retry shortly",
        ),
      };
    }
    return { ok: true, row, manifest };
  }

  function buildServer(shares: Map<string, KbShareRow>): McpServer {
    const server = new McpServer(
      { name: "knowledge-bases", version: "1.0.0" },
      {
        instructions:
          "Read-only access to knowledge bases shared with this agent. Call list_knowledge_bases first to see what is available and how to navigate each one; every other tool takes a `kb` id from that list. These knowledge bases are live snapshots that can change between turns — before you state anything about their contents (counts, whether a document exists, what it says), call the relevant tool again in the current turn rather than reusing output from earlier in the conversation.",
      },
    );

    server.tool(
      "list_knowledge_bases",
      "List the shared knowledge bases this agent can read. Returns one entry per knowledge base: its `kb` id (pass it to every other tool), name, snapshot freshness, document count, total size, and a usage guide when the knowledge base ships one.",
      {},
      async () => {
        try {
          const entries = [];
          for (const [shareId, row] of shares) {
            let guide = FALLBACK_GUIDE;
            let updatedAt: string | null = null;
            if (row.snapshotId && row.snapshotManifestKey) {
              const manifest = await deps.reader.getManifest(
                row.snapshotManifestKey,
                row.snapshotId,
              );
              if (manifest) {
                guide =
                  (await deps.reader.readGuide(manifest)) ?? FALLBACK_GUIDE;
                updatedAt = manifest.createdAt;
              }
            }
            entries.push({
              kb: shareId,
              name: row.publicName ?? (await deps.agentName(row.agentId)),
              published: row.snapshotId !== null,
              updatedAt,
              documentCount: row.documentCount,
              totalSizeBytes: row.totalSizeBytes,
              guide,
            });
            recordQuery(row, "list_knowledge_bases");
          }
          return textResult(JSON.stringify({ knowledgeBases: entries }));
        } catch (err) {
          return unexpectedError("list_knowledge_bases", err);
        }
      },
    );

    server.tool(
      "list_documents",
      "List the documents inside one shared knowledge base. Returns paths and sizes; pass `prefix` to narrow to a subdirectory. Results cap at 2000 entries with a `truncated` flag.",
      {
        kb: z.string().describe("Knowledge base id from list_knowledge_bases."),
        prefix: z
          .string()
          .optional()
          .describe("Only paths starting with this prefix, e.g. wiki/guides/."),
      },
      async ({ kb, prefix }) => {
        try {
          const resolved = await resolveManifest(shares, kb);
          if (!resolved.ok) return resolved.error;
          const matching = resolved.manifest.files.filter(
            (f) => !prefix || f.path.startsWith(prefix),
          );
          const documents = matching
            .slice(0, LIST_DOCUMENTS_MAX)
            .map((f) => ({ path: f.path, sizeBytes: f.sizeBytes }));
          recordQuery(resolved.row, "list_documents");
          return textResult(
            JSON.stringify({
              documents,
              truncated: matching.length > LIST_DOCUMENTS_MAX,
              snapshotCreatedAt: resolved.manifest.createdAt,
            }),
          );
        } catch (err) {
          return unexpectedError("list_documents", err);
        }
      },
    );

    server.tool(
      "read_document",
      `Read one document from a shared knowledge base. Returns up to ${READ_DEFAULT_MAX_CHARS} characters per call with a \`truncated\` flag; pass \`offset\` to continue a truncated read.`,
      {
        kb: z.string().describe("Knowledge base id from list_knowledge_bases."),
        path: z
          .string()
          .min(1)
          .describe("Document path exactly as returned by list_documents."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Character offset to start from (for truncated reads)."),
        maxChars: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            `Characters to return, capped at ${READ_DEFAULT_MAX_CHARS}.`,
          ),
      },
      async ({ kb, path, offset, maxChars }) => {
        try {
          const resolved = await resolveManifest(shares, kb);
          if (!resolved.ok) return resolved.error;
          const slice = await deps.reader.readDocument(
            resolved.manifest,
            path,
            {
              ...(offset !== undefined ? { offset } : {}),
              ...(maxChars !== undefined ? { maxChars } : {}),
            },
          );
          recordQuery(resolved.row, "read_document");
          if (!slice) return errorResult(`document not found: ${path}`);
          return textResult(
            [
              slice.content,
              "",
              `${slice.truncated ? `(truncated at ${slice.content.length} of ${slice.totalChars} characters — continue with offset) ` : ""}${staleness(resolved.manifest)}`,
            ].join("\n"),
          );
        } catch (err) {
          return unexpectedError("read_document", err);
        }
      },
    );

    server.tool(
      "search_knowledge",
      "Full-text search inside one shared knowledge base. Ranks documents by relevance (BM25) across your query words — a document need not contain every word — with short snippets; plurals are matched (e.g. page/pages). Follow up with read_document on the best paths.",
      {
        kb: z.string().describe("Knowledge base id from list_knowledge_bases."),
        query: z.string().min(1).describe("Words to search for."),
      },
      async ({ kb, query }) => {
        const resolved = await resolveManifest(shares, kb);
        if (!resolved.ok) return resolved.error;
        try {
          return await deps.limits.withSlot(kb, async () => {
            const search = await deps.reader.getSearch(resolved.manifest);
            if (search.kind === "unreadable") {
              requestIndexHeal(resolved.row, resolved.manifest.snapshotId);
              return errorResult(
                "search is temporarily unavailable for this knowledge base — its index is being rebuilt; retry shortly",
              );
            }
            if (search.kind === "none") {
              return errorResult(
                "search is unavailable for this knowledge base — its snapshot predates search; ask the owner to refresh the share",
              );
            }
            const hits =
              search.kind === "legacy"
                ? querySearchIndex(search.index, query, SEARCH_TOP_DOCS)
                : querySegments(search.segments, query, SEARCH_TOP_DOCS);
            const degraded =
              search.kind === "legacy"
                ? search.index.degraded
                : search.degraded;
            const needles = [...new Set(tokenize(query))];
            const results = [];
            for (const hit of hits) {
              const text = await deps.reader.readDocumentText(
                resolved.manifest,
                hit.path,
              );
              results.push({
                path: hit.path,
                score: hit.score,
                snippets: text
                  ? extractSnippets(
                      text,
                      needles,
                      SNIPPET_CONTEXT_LINES,
                      SNIPPETS_PER_DOC,
                    )
                  : [],
              });
            }
            recordQuery(resolved.row, "search_knowledge");
            return textResult(
              [
                JSON.stringify({ results, degraded }),
                staleness(resolved.manifest),
              ].join("\n"),
            );
          });
        } catch (err) {
          if (err instanceof QueryBusyError) return errorResult(err.message);
          return unexpectedError("search_knowledge", err);
        }
      },
    );

    server.tool(
      "grep_documents",
      "Search one shared knowledge base with a regular expression, line by line. Returns matching lines with context. Scans up to 20 MB per call with a `truncated` flag; pass `glob` (e.g. wiki/**/*.md) to narrow the files scanned.",
      {
        kb: z.string().describe("Knowledge base id from list_knowledge_bases."),
        pattern: z
          .string()
          .min(1)
          .max(1000)
          .describe("JavaScript regular expression, matched per line."),
        glob: z
          .string()
          .max(200)
          .optional()
          .describe("Only scan paths matching this glob (supports ** * ?)."),
        contextLines: z
          .number()
          .int()
          .min(0)
          .max(5)
          .optional()
          .describe("Lines of context around each match (default 1)."),
      },
      async ({ kb, pattern, glob, contextLines }) => {
        const resolved = await resolveManifest(shares, kb);
        if (!resolved.ok) return resolved.error;
        try {
          return await deps.limits.withSlot(kb, async () => {
            let candidates = resolved.manifest.files;
            if (glob) {
              const matched = new Set(
                await runGlobFilterWorker({
                  glob,
                  paths: candidates.map((f) => f.path),
                  deadlineMs: grepDeadlineMs,
                }),
              );
              candidates = candidates.filter((f) => matched.has(f.path));
            }
            const files: GrepInputFile[] = [];
            let scannedBytes = 0;
            let budgetExhausted = false;
            for (const file of candidates) {
              if (scannedBytes + file.sizeBytes > GREP_SCAN_BUDGET_BYTES) {
                budgetExhausted = true;
                break;
              }
              const text = await deps.reader.readDocumentText(
                resolved.manifest,
                file.path,
              );
              if (text === null) continue;
              scannedBytes += file.sizeBytes;
              files.push({ path: file.path, text });
            }
            const outcome = await runGrepWorker({
              pattern,
              files,
              contextLines: contextLines ?? 1,
              deadlineMs: grepDeadlineMs,
            });
            recordQuery(resolved.row, "grep_documents");
            return textResult(
              [
                JSON.stringify({
                  matches: outcome.matches,
                  truncated: outcome.truncated || budgetExhausted,
                  scannedBytes,
                }),
                staleness(resolved.manifest),
              ].join("\n"),
            );
          });
        } catch (err) {
          if (err instanceof QueryBusyError) return errorResult(err.message);
          if (err instanceof GrepPatternError) {
            return errorResult(`invalid pattern: ${err.message}`);
          }
          if (err instanceof GrepDeadlineError) {
            return errorResult(
              `grep exceeded its ${grepDeadlineMs / 1000} s time budget — narrow the pattern or glob and retry`,
            );
          }
          return unexpectedError("grep_documents", err);
        }
      },
    );

    return server;
  }

  const app = new Hono();

  app.all("/mcp/kb", async (c) => {
    const shares = await resolveAccessibleShares(c.req.raw.headers, deps);
    if (shares.size === 0) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const server = buildServer(shares);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  app.all("/mcp/kb/*", (c) => c.json({ error: "not found" }, 404));

  return app;
}
