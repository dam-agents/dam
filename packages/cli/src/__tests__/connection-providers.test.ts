// TEST_OVERVIEW: `dam connection list` and `dam connection templates` show which connections and templates are model providers: a PROVIDER column with the alias, the harnesses that run on it and the preferred mark, and a --providers filter that keeps only them, in the table and in --json. A server that sends no provider field still gets its providers recognised by template id.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { buildListCommand } from "../modules/connection/commands/list.js";
import { buildTemplatesCommand } from "../modules/connection/commands/templates.js";
import type { ConnectionService } from "../modules/connection/services/connection-service.js";
import { EXIT_SUCCESS } from "../modules/shared/exit-codes.js";

const view = (over: Partial<ConnectionView>): ConnectionView => ({
  id: "conn-x",
  ownerId: "user-1",
  templateId: "github",
  category: "app",
  name: "x",
  status: "active",
  authKind: "oauth",
  contributions: [],
  hosts: [],
  ...over,
});

const github = view({ id: "conn-gh", name: "GitHub", hosts: ["github.com"] });
const claude = view({
  id: "conn-claude",
  name: "Claude",
  templateId: "anthropic-oauth",
  provider: { alias: "anthropic", harnesses: ["claude-code"], preferred: true },
});
const litellm = view({
  id: "conn-ibm",
  name: "LiteLLM",
  templateId: "ibm-litellm",
  provider: {
    alias: "ibm",
    harnesses: ["claude-code", "codex", "pi"],
    preferred: false,
  },
});

const template = (
  over: Partial<ConnectionTemplateView>,
): ConnectionTemplateView => ({
  id: "github",
  name: "GitHub",
  category: "app",
  isCustom: false,
  authKind: "oauth",
  inputs: [],
  ...over,
});

const deps = (svc: Partial<ConnectionService>) => ({
  compatService: {
    check: async () => ({
      ok: true as const,
      value: {
        kind: "ok" as const,
        localCli: "1.0.0",
        serverVersion: "1.0.0",
        serverMinClient: undefined,
        serverRecommendedClient: undefined,
      },
    }),
  },
  configService: {
    getResolved: async () => ({
      ok: true as const,
      value: { server: "http://localhost:4444" },
    }),
    set: vi.fn(),
  },
  createAgentService: () => {
    throw new Error("no agent lookup expected");
  },
  createConnectionService: () => svc as ConnectionService,
});

let stdout = "";

async function run(
  command: { parseAsync: (a: string[], o: { from: "user" }) => unknown },
  args: string[],
) {
  stdout = "";
  await expect(command.parseAsync(args, { from: "user" })).rejects.toThrow(
    `exit ${EXIT_SUCCESS}`,
  );
  return stdout;
}

beforeEach(() => {
  stdout = "";
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: unknown, done?: unknown) => {
      stdout += String(chunk);
      if (typeof done === "function") (done as () => void)();
      return true;
    },
  );
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe("dam connection list", () => {
  const list = () =>
    buildListCommand(
      deps({
        list: async () => ({ ok: true, value: [github, claude, litellm] }),
      }),
    );

  /** TEST_SCENARIO: the table names each provider's alias and harnesses and
   * marks the preferred one; GitHub shows no provider. */
  it("shows a PROVIDER column", async () => {
    const out = await run(list(), []);
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/PROVIDER/);
    expect(lines.find((l) => l.startsWith("conn-claude"))).toContain(
      "anthropic (claude-code) preferred",
    );
    expect(lines.find((l) => l.startsWith("conn-ibm"))).toContain(
      "ibm (claude-code,codex,pi)",
    );
    expect(lines.find((l) => l.startsWith("conn-ibm"))).not.toContain(
      "preferred",
    );
    expect(lines.find((l) => l.startsWith("conn-gh"))).toContain("—");
  });

  /** TEST_SCENARIO: --providers keeps only model providers, in --json too,
   * so an agent can read the ids `dam agent create --provider` takes. */
  it("filters to providers with --providers", async () => {
    const out = await run(list(), ["--providers", "--json"]);
    expect(
      (JSON.parse(out) as ConnectionView[]).map((c) => c.id).sort(),
    ).toEqual(["conn-claude", "conn-ibm"]);
    const table = await run(list(), ["--providers"]);
    expect(table).not.toContain("conn-gh");
  });

  /** TEST_SCENARIO: a server from before the provider field still lists its
   * providers under --providers, by template id, with the alias alone. */
  it("recognises providers by template id without the provider field", async () => {
    const bare = { ...litellm, provider: undefined };
    const command = buildListCommand(
      deps({ list: async () => ({ ok: true, value: [github, bare] }) }),
    );
    const out = await run(command, ["--providers"]);
    expect(out).toContain("conn-ibm");
    expect(out).not.toContain("conn-gh");
    expect(out.split("\n").find((l) => l.startsWith("conn-ibm"))).toMatch(
      /\bibm\b/,
    );
  });
});

describe("dam connection templates", () => {
  const templates = () =>
    buildTemplatesCommand(
      deps({
        listTemplates: async () => ({
          ok: true,
          value: [
            template({}),
            template({
              id: "openai",
              name: "OpenAI",
              authKind: "header",
              provider: { alias: "openai", harnesses: ["codex", "pi"] },
            }),
            template({ id: "mcp-x", name: "MCP", category: "mcp" }),
          ],
        }),
      }),
    );

  /** TEST_SCENARIO: provider templates name their alias and harnesses, and
   * --providers lists them alone. */
  it("shows and filters provider templates", async () => {
    const out = await run(templates(), []);
    expect(out.split("\n")[0]).toMatch(/PROVIDER/);
    expect(out).toContain("openai (codex,pi)");
    const json = await run(templates(), ["--providers", "--json"]);
    expect(
      (JSON.parse(json) as ConnectionTemplateView[]).map((t) => t.id),
    ).toEqual(["openai"]);
  });
});
