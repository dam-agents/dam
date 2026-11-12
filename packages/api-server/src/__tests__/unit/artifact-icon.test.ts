// TEST_OVERVIEW: An artifact carries the icon its Agent picked, one emoji, and
// TEST_OVERVIEW: every page that shows the artifact alone in a browser tab uses
// TEST_OVERVIEW: it as the tab's favicon: the share page and the framed
// TEST_OVERVIEW: document. With no icon the share page shows the brand icon.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import {
  createMcpSession,
  type McpSessionDeps,
} from "../../apps/harness-api-server/mcp-endpoint.js";
import { artifactIconSvg, isArtifactIcon } from "api-server-api";
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
  it.each(["📈", "🗓️", "👩‍💻", "🇨🇿", "1️⃣", "👍🏽", "🤷🏽‍♀️", "❤️"])(
    "takes the emoji %j",
    (icon) => {
      expect(isArtifactIcon(icon)).toBe(true);
    },
  );

  // TEST_SCENARIO: The agent wrote something that is not exactly one emoji, such as two emoji, a word or markup; it is refused, so a stored icon always draws.
  it.each(["", "📈📊", "chart-line", "a", " 📈", "<script>"])(
    "refuses %j",
    (raw) => {
      expect(isArtifactIcon(raw)).toBe(false);
    },
  );

  it("draws an emoji as text, and nothing for a value that is no icon", () => {
    expect(artifactIconSvg("📈")).toContain(">📈</text>");
    expect(artifactIconSvg("<b>")).toBeNull();
  });
});

const BRAND_ICON = "https://app.example.com/api/brand/icon.svg";

const wrapperBase = {
  title: "Costs",
  brandIconUrl: BRAND_ICON,
  brandName: "Platform",
  contentUrl: "https://content.example.com/a/s?v=1",
  slug: "s",
  version: 1,
  downloadName: "costs.html",
};

describe("the favicon of an artifact's pages", () => {
  it("is the artifact's icon on its share page", () => {
    const svg = faviconSvg(renderWrapper({ ...wrapperBase, icon: "📊" }));
    expect(svg).toBe(artifactIconSvg("📊"));
  });

  // TEST_SCENARIO: An artifact published before icons existed, or uploaded by the user, has none; its share page shows the brand icon, as the app does.
  it("is the brand icon when the artifact has no icon", () => {
    expect(faviconHref(renderWrapper({ ...wrapperBase, icon: null }))).toBe(
      BRAND_ICON,
    );
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
  it("stores the icon an agent publishes with", async () => {
    const created = await serviceOver([]).create(
      { title: "Costs", icon: " 📈 ", content: "<p>1</p>", kind: "html" },
      { author: "agent", agentId: "agent-1" },
    );
    expect(created.icon).toBe("📈");
  });

  // TEST_SCENARIO: An agent on an older skill, or one that leaves the icon out, still publishes; the artifact has no icon until the agent or the owner gives it one.
  it("publishes without an icon", async () => {
    const created = await serviceOver([]).create(
      { title: "Costs", content: "<p>1</p>", kind: "html" },
      { author: "agent", agentId: "agent-1" },
    );
    expect(created.icon).toBeNull();
  });

  it("refuses a publish whose icon is no icon", async () => {
    const service = serviceOver([]);
    await expect(
      service.create(
        {
          title: "Costs",
          icon: "chart-line",
          content: "<p>1</p>",
          kind: "html",
        },
        { author: "agent", agentId: "agent-1" },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // TEST_SCENARIO: The agent publishes a new version and names no icon; the artifact's tab keeps the icon it had.
  it("keeps the icon across a new version", async () => {
    const rows = [row({ icon: "✅" })];
    const updated = await serviceOver(rows).update(
      "a1",
      { content: "<p>2</p>" },
      { agentId: "agent-1" },
    );
    expect(updated).toMatchObject({ version: 2, icon: "✅" });
  });

  // TEST_SCENARIO: The owner clears a bad pick in the app; the artifact has no icon again, and its tabs show the brand icon.
  it("clears the icon on an update with null", async () => {
    const rows = [row({ icon: "✅" })];
    const updated = await serviceOver(rows).update(
      "a1",
      { icon: null },
      { user: true },
    );
    expect(updated.icon).toBeNull();
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
  // TEST_SCENARIO: The user never asks for an icon; the tool tells the agent to always set one, as it sets the title, and to pick one that tells the artifact from its neighbours.
  it("tell the agent to always pick an icon, without making it required", async () => {
    const { client } = await mcpClient();
    const { tools } = await client.listTools();
    const create = tools.find((t) => t.name === "create_artifact")!;
    expect(create.inputSchema.required).not.toContain("icon");
    expect(create.description).toContain("Always set `icon`");
    expect(create.description).toContain("tells this artifact apart");
    const update = tools.find((t) => t.name === "update_artifact")!;
    expect(update.inputSchema.required).not.toContain("icon");
    expect(update.description).toContain("`icon` is null");
  });

  it("passes the icon to the library and returns it", async () => {
    const { client, artifactLibrary } = await mcpClient();
    const result = await client.callTool({
      name: "create_artifact",
      arguments: { title: "Checklist", icon: "✅", content: "# x" },
    });
    expect(result.isError).toBeFalsy();
    expect(artifactLibrary.create).toHaveBeenCalledWith(
      expect.objectContaining({ icon: "✅" }),
      { author: "agent", agentId: "agent-1" },
    );
    const text = (result.content as { text: string }[])[0]!.text;
    expect(JSON.parse(text)).toMatchObject({ icon: "✅" });
  });
});
