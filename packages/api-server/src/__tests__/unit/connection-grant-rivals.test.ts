/**
 * TEST_OVERVIEW: Two Connections granted to one agent are rivals when both inject
 * the same header on the same host over overlapping paths, and the platform gives
 * at least one of them no address the agent can use there. The gateway refuses
 * unaddressed requests on such a host, so the pair can never work together:
 * this is the check that decides which grants an agent is refused. The cases
 * use the real catalog templates, so they describe the Connections users hold.
 */
import { describe, it, expect } from "vitest";
import type {
  ConnectionCreateInput,
  Contribution,
  SecretRef,
} from "api-server-api";
import { unaddressableRivalHost } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";

const catalog = buildCatalog();

function templateContributions(id: string): Contribution[] {
  const template = catalog.find((t) => t.id === id);
  if (!template) throw new Error(`${id} missing from catalog`);
  return [...template.contributions];
}

function googleServiceOn(pathPattern: string): Contribution[] {
  const template = catalog.find((t) =>
    t.contributions.some(
      (c) => c.kind === "egress-inject" && c.pathPattern === pathPattern,
    ),
  );
  if (!template) throw new Error(`no template injects on ${pathPattern}`);
  return [...template.contributions];
}

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

async function built(input: ConnectionCreateInput): Promise<Contribution[]> {
  const template = catalog.find((t) => t.id === input.templateId);
  if (!template) throw new Error(`${input.templateId} missing from catalog`);
  const connection = await buildConnection(
    template,
    input,
    mintRef,
    "https://platform.example.com/api/oauth/callback",
    "Platform",
  );
  return connection.contributions;
}

function gheOn(host: string): Promise<Contribution[]> {
  return built({
    templateId: "github-enterprise-pat",
    authKind: "header",
    name: host,
    host,
    value: "ghp_x",
  });
}

function customMcpAt(url: string): Promise<Contribution[]> {
  return built({
    templateId: "custom-mcp-none",
    authKind: "none",
    name: "observe",
    url,
    headerName: "Authorization",
    value: "secret",
  });
}

const as = (id: string, contributions: Contribution[]) => ({
  id,
  contributions,
});

describe("unaddressableRivalHost", () => {
  /** TEST_SCENARIO: The reported case. GitHub OAuth and a GitHub personal access
   * token both inject Authorization on the GitHub hosts, and gh cannot name one,
   * so they are rivals. */
  it("finds GitHub OAuth and a GitHub token rivals on the GitHub API host", () => {
    const host = unaddressableRivalHost(
      as("conn-oauth", templateContributions("github")),
      as("conn-pat", templateContributions("github-pat")),
    );
    expect(host).toBe("api.github.com");
  });

  /** TEST_SCENARIO: Every GitHub sign-in method injects on the same hosts, so any
   * two of them collide, not just OAuth and a token. */
  it("finds a GitHub token and a GitHub App rivals", () => {
    expect(
      unaddressableRivalHost(
        as("conn-pat", templateContributions("github-pat")),
        as("conn-app", templateContributions("github-app")),
      ),
    ).toBeDefined();
  });

  /** TEST_SCENARIO: Two Slack workspaces reach Slack through MCP entries, which
   * the platform delivers under each Connection's own address. They must stay
   * grantable together. */
  it("does not find two Slack workspaces rivals", () => {
    const slack = templateContributions("slack");
    expect(
      unaddressableRivalHost(as("conn-a", slack), as("conn-b", slack)),
    ).toBeUndefined();
  });

  /** TEST_SCENARIO: Two tenants of one MCP server are addressed the same way as
   * two Slack workspaces, so they are not rivals either. */
  it("does not find two custom MCP servers at one URL rivals", async () => {
    const url = "https://observe.example.com/api/mcp";
    expect(
      unaddressableRivalHost(
        as("conn-a", await customMcpAt(url)),
        as("conn-b", await customMcpAt(url)),
      ),
    ).toBeUndefined();
  });

  /** TEST_SCENARIO: Google services share one host but inject on different paths.
   * Paths that do not overlap do not compete for the header. */
  it("does not find two Google services on separate paths rivals", () => {
    expect(
      unaddressableRivalHost(
        as("conn-mail", googleServiceOn("/gmail/*")),
        as("conn-cal", googleServiceOn("/calendar/*")),
      ),
    ).toBeUndefined();
  });

  /** TEST_SCENARIO: Two accounts of the same Google service claim the same path,
   * and a path-scoped injection is never addressed, so they are rivals. */
  it("finds two accounts of one Google service rivals", () => {
    const calendar = googleServiceOn("/calendar/*");
    expect(
      unaddressableRivalHost(as("conn-a", calendar), as("conn-b", calendar)),
    ).toBe("www.googleapis.com");
  });

  /** TEST_SCENARIO: GitHub Enterprise lives on its own host, so it never competes
   * with github.com, and two servers on different hosts never compete either. */
  it("keeps GitHub and GitHub Enterprise servers on other hosts apart", async () => {
    const acme = await gheOn("ghe.acme.com");
    expect(
      unaddressableRivalHost(
        as("conn-github", templateContributions("github-pat")),
        as("conn-acme", acme),
      ),
    ).toBeUndefined();
    expect(
      unaddressableRivalHost(
        as("conn-acme", acme),
        as("conn-other", await gheOn("ghe.other.com")),
      ),
    ).toBeUndefined();
  });

  /** TEST_SCENARIO: Two accounts on one GitHub Enterprise server collide the way
   * two github.com accounts do. */
  it("finds two accounts on one GitHub Enterprise server rivals", async () => {
    expect(
      unaddressableRivalHost(
        as("conn-a", await gheOn("ghe.acme.com")),
        as("conn-b", await gheOn("ghe.acme.com")),
      ),
    ).toBe("api.ghe.acme.com");
  });

  /** TEST_SCENARIO: A Connection is never its own rival, so checking a grant set
   * that contains it does not refuse it. */
  it("does not find a connection its own rival", () => {
    const github = as("conn-a", templateContributions("github"));
    expect(unaddressableRivalHost(github, github)).toBeUndefined();
  });
});
