// TEST_OVERVIEW: An artifact carries the icon its Agent picked, one emoji or a
// TEST_OVERVIEW: free Font Awesome icon name, and every page that shows the
// TEST_OVERVIEW: artifact alone in a browser tab uses it as the tab's favicon:
// TEST_OVERVIEW: the share page, the framed document, and the app's own page
// TEST_OVERVIEW: through the public icon route.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import {
  createMcpSession,
  type McpSessionDeps,
} from "../../apps/harness-api-server/mcp-endpoint.js";
import {
  artifactIconSvg,
  parseArtifactIcon,
} from "../../modules/artifact-library/domain/artifact-icon.js";
import { createArtifactIconRoutes } from "../../modules/artifact-library/icon-routes.js";
import type {
  ArtifactLibraryRepository,
  ArtifactRow,
} from "../../modules/artifact-library/infrastructure/artifact-library-repository.js";
import { createArtifactLibraryService } from "../../modules/artifact-library/services/artifact-library-service.js";
import type { ArtifactService } from "../../modules/artifacts/services/artifact-service.js";
import {
  renderTextKindInner,
  renderWrapper,
} from "../../modules/artifact-library/viewer/renderer.js";

function faviconHref(html: string): string | null {
  const match = html.match(/<link rel="icon" href="([^"]*)"\/>/);
  return match ? match[1]!.replaceAll("&amp;", "&") : null;
}

function faviconSvg(html: string): string | null {
  const href = faviconHref(html);
  if (href === null) return null;
  expect(href.startsWith("data:image/svg+xml,")).toBe(true);
  return decodeURIComponent(href.slice("data:image/svg+xml,".length));
}

describe("the icon an agent may pick", () => {
  it.each([
    ["📈", "📈"],
    [" 🗓️ ", "🗓️"],
    ["👩‍💻", "👩‍💻"],
    ["🇨🇿", "🇨🇿"],
    ["chart-line", "chart-line"],
    ["fa-list-check", "list-check"],
    ["fa-solid fa-chart-line", "chart-line"],
    ["line-chart", "chart-line"],
    ["face-smile", "face-smile"],
    ["GitHub", "github"],
  ])("stores %j as %j", (raw, stored) => {
    expect(parseArtifactIcon(raw)).toEqual({ ok: true, icon: stored });
  });

  // TEST_SCENARIO: The agent wrote something that is neither one emoji nor a free Font Awesome icon; the refusal names the two forms, so the agent can pick again.
  it.each(["", "📈📊", "chart", "no-such-icon-at-all", "<script>"])(
    "refuses %j with a reason",
    (raw) => {
      const parsed = parseArtifactIcon(raw);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toMatch(/emoji|empty/);
    },
  );

  it("draws a Font Awesome icon from its own path, with its attribution", () => {
    const svg = artifactIconSvg("chart-line")!;
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 512 512">/,
    );
    expect(svg).toContain('<path d="M64 64c');
    expect(svg).toContain("Font Awesome Free");
    expect(svg).toContain("prefers-color-scheme:dark");
  });

  it("draws an emoji as text, and nothing for an unknown value", () => {
    expect(artifactIconSvg("📈")).toContain(">📈</text>");
    expect(artifactIconSvg("<b>")).toBeNull();
  });
});

const wrapperBase = {
  title: "Costs",
  brandName: "Platform",
  contentUrl: "https://content.example.com/a/s?v=1",
  slug: "s",
  version: 1,
  downloadName: "costs.html",
};

describe("the favicon of an artifact's pages", () => {
  it("is the artifact's icon on its share page", () => {
    const svg = faviconSvg(
      renderWrapper({ ...wrapperBase, icon: "chart-line" }),
    );
    expect(svg).toBe(artifactIconSvg("chart-line"));
  });

  // TEST_SCENARIO: An artifact published before icons existed, or uploaded by the user, has none; its share page names no favicon, as before.
  it("is left out when the artifact has no icon", () => {
    expect(
      faviconHref(renderWrapper({ ...wrapperBase, icon: null })),
    ).toBeNull();
  });

  it.each(["html", "jsx", "markdown", "code"] as const)(
    "is in the framed %s document too",
    (kind) => {
      const html = renderTextKindInner(kind, "<p>x</p>", {
        title: "T",
        icon: "📋",
        fileName: "t.txt",
      });
      expect(faviconSvg(html)).toContain(">📋</text>");
    },
  );

  // TEST_SCENARIO: The agent's own HTML already names a favicon; the artifact's icon does not add a second one beside it.
  it("leaves an HTML artifact's own favicon alone", () => {
    const html = renderTextKindInner(
      "html",
      `<html><head><link rel="shortcut icon" href="https://example.com/i.png"></head></html>`,
      { title: "T", icon: "📋", fileName: "t.html" },
    );
    expect(faviconHref(html)).toBeNull();
    expect(html).toContain("https://example.com/i.png");
  });
});

describe("the app's artifact icon route", () => {
  const routes = createArtifactIconRoutes();

  it("serves a stored icon as SVG", async () => {
    const res = await routes.request(
      `/?icon=${encodeURIComponent("list-check")}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(await res.text()).toBe(artifactIconSvg("list-check"));
  });

  it("answers 404 for a value that is no icon", async () => {
    expect((await routes.request("/?icon=nope-nope")).status).toBe(404);
    expect((await routes.request("/")).status).toBe(404);
  });
});

function row(overrides: Partial<ArtifactRow> = {}): ArtifactRow {
  return {
    id: "a1",
    owner: "o1",
    agentId: "agent-1",
    folderId: null,
    sourcePath: null,
    icon: null,
    title: "Costs",
    slug: "slug-a",
    kind: "html",
    contentType: "text/html",
    fileName: "costs.html",
    storageRef: "library/o1/a1/v1/costs.html",
    sizeBytes: 10,
    version: 1,
    visibility: "private",
    interactive: false,
    expiresAt: null,
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function serviceOver(rows: ArtifactRow[]) {
  const apply = (id: string, patch: Partial<ArtifactRow>) => {
    const found = rows.find((r) => r.id === id);
    if (!found) return Promise.resolve(null);
    Object.assign(found, patch);
    return Promise.resolve(found);
  };
  const repo = new Proxy({} as ArtifactLibraryRepository, {
    get: (_target, method: string) => {
      if (method === "insertArtifact")
        return (inserted: ArtifactRow) => {
          const created = row(inserted);
          rows.push(created);
          return Promise.resolve(created);
        };
      if (method === "getArtifact")
        return (id: string) =>
          Promise.resolve(rows.find((r) => r.id === id) ?? null);
      if (method === "updateArtifact")
        return (id: string, _owner: string, patch: Partial<ArtifactRow>) =>
          apply(id, patch);
      if (method === "advanceVersion")
        return (
          id: string,
          _owner: string,
          _expected: number,
          patch: Partial<ArtifactRow>,
        ) => apply(id, patch);
      if (method === "listViewers") return () => Promise.resolve([]);
      throw new Error(`${method} is not expected`);
    },
  });
  const artifacts = {
    put: () => Promise.resolve(),
  } as unknown as ArtifactService;
  return createArtifactLibraryService({
    repo,
    artifacts,
    owner: "o1",
    shareBaseUrl: "https://share.example.com",
    surface: "mcp",
    ensureReady: () => Promise.resolve(),
    agentApi: { request: () => Promise.reject(new Error("unused")) },
    prompts: { deliver: () => Promise.reject(new Error("unused")) },
  });
}

describe("the library keeps an artifact's icon", () => {
  it("stores the icon's canonical name when an agent publishes", async () => {
    const service = serviceOver([]);
    const created = await service.create(
      {
        title: "Costs",
        icon: "fa-line-chart",
        content: "<p>1</p>",
        kind: "html",
      },
      { author: "agent", agentId: "agent-1" },
    );
    expect(created.icon).toBe("chart-line");
  });

  it("refuses a publish whose icon is no icon", async () => {
    const service = serviceOver([]);
    await expect(
      service.create(
        { title: "Costs", icon: "chart", content: "<p>1</p>", kind: "html" },
        { author: "agent", agentId: "agent-1" },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // TEST_SCENARIO: The agent publishes a new version and names no icon; the artifact's tab keeps the icon it had.
  it("keeps the icon across a new version", async () => {
    const rows = [row({ icon: "list-check" })];
    const updated = await serviceOver(rows).update(
      "a1",
      { content: "<p>2</p>" },
      { agentId: "agent-1" },
    );
    expect(updated).toMatchObject({ version: 2, icon: "list-check" });
  });

  it("gives an artifact without an icon one on update", async () => {
    const rows = [row()];
    const updated = await serviceOver(rows).update("a1", { icon: "🧾" });
    expect(updated.icon).toBe("🧾");
  });
});

async function mcpClient() {
  const artifactLibrary = {
    create: vi.fn(async (input: { title: string; icon?: string }) => ({
      ...row({ title: input.title, icon: input.icon ?? null }),
      createdAt: "2026-11-12T00:00:00.000Z",
      updatedAt: "2026-11-12T00:00:00.000Z",
      expiresAt: null,
      shareUrl: null,
      viewers: [],
    })),
  };
  const session = createMcpSession("agent-1", {
    channelManager: {},
    k8s: { namespace: "platform" },
    maxArtifactBytes: 10 * 1024 * 1024,
    artifactLibrary,
  } as unknown as McpSessionDeps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await session.server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, artifactLibrary };
}

describe("the agent's publish tools ask for an icon", () => {
  // TEST_SCENARIO: The user never asks for an icon; the tool makes it as much a part of publishing as the title, so every new artifact gets one.
  it("make icon a required field of create_artifact and tell the agent to always pick one", async () => {
    const { client } = await mcpClient();
    const { tools } = await client.listTools();
    const create = tools.find((t) => t.name === "create_artifact")!;
    expect(create.inputSchema.required).toEqual(
      expect.arrayContaining(["title", "icon"]),
    );
    expect(create.description).toContain("Always set `icon`");
    const update = tools.find((t) => t.name === "update_artifact")!;
    expect(update.inputSchema.required).not.toContain("icon");
    expect(update.description).toContain("`icon` is null");
  });

  it("passes the icon to the library and returns it", async () => {
    const { client, artifactLibrary } = await mcpClient();
    const result = await client.callTool({
      name: "create_artifact",
      arguments: { title: "Checklist", icon: "list-check", content: "# x" },
    });
    expect(result.isError).toBeFalsy();
    expect(artifactLibrary.create).toHaveBeenCalledWith(
      expect.objectContaining({ icon: "list-check" }),
      { author: "agent", agentId: "agent-1" },
    );
    const text = (result.content as { text: string }[])[0]!.text;
    expect(JSON.parse(text)).toMatchObject({ icon: "list-check" });
  });

  it("refuses a create_artifact call without an icon", async () => {
    const { client, artifactLibrary } = await mcpClient();
    const result = await client.callTool({
      name: "create_artifact",
      arguments: { title: "Checklist", content: "# x" },
    });
    expect(result.isError).toBe(true);
    expect(artifactLibrary.create).not.toHaveBeenCalled();
  });
});
