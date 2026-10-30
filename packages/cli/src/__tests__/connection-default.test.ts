// TEST_OVERVIEW: An agent that holds several GitHub accounts on one host acts as one of them by default, as the web app's Connections panel shows. `dam connection list <agent>` marks that one in a DEFAULT column and in --json, and `dam connection default <agent> --connection <ref>` makes another one the default; it refuses a connection the agent does not hold, or one no default is picked among, before it changes anything.
import { describe, expect, it, vi } from "vitest";
import type { ConnectionView } from "api-server-api";
import type { AgentView } from "../modules/agent/domain/agent-view.js";
import { buildDefaultCommand } from "../modules/connection/commands/default.js";
import { buildListCommand } from "../modules/connection/commands/list.js";
import type { AgentGrant } from "../modules/connection/services/connection-service.js";
import { EXIT_INVALID_INPUT } from "../modules/shared/exit-codes.js";
import {
  captureOutput,
  deps,
  ok,
  output,
  run,
  slack,
  view,
} from "./connection-commands.js";

captureOutput();

const enterprisePat = (id: string, name: string): ConnectionView =>
  view({
    id,
    name,
    templateId: "github-enterprise-pat",
    authKind: "header",
    hosts: ["github.ibm.com"],
    contributions: [
      { kind: "env", name: "GH_TOKEN", placeholder: `platform:conn:${id}` },
      { kind: "env", name: "GH_HOST", placeholder: "github.ibm.com" },
    ],
  });

const first = enterprisePat("conn-first", "ghe-first");
const second = enterprisePat("conn-second", "ghe-second");

const grant = (connectionId: string, grantedAt: string): AgentGrant => ({
  connectionId,
  grantedAt,
  preferred: false,
});

const grants = [
  grant("conn-first", "2026-10-01T00:00:00Z"),
  grant("conn-second", "2026-10-02T00:00:00Z"),
  grant("conn-slack", "2026-10-03T00:00:00Z"),
];

const agents = {
  list: async () =>
    ok([{ id: "agent-00000000000000aa", name: "scout" } as AgentView]),
};

const service = (agentGrants: readonly AgentGrant[] = grants) => ({
  list: async () => ok([first, second, slack]),
  agentGrants: async () => ok(agentGrants),
  setDefault: vi.fn(async () => ok(undefined)),
});

const rowOf = (out: string, id: string) =>
  out.split("\n").find((line) => line.startsWith(id)) ?? "";

describe("dam connection list <agent>", () => {
  /** TEST_SCENARIO: with no default picked, the earliest granted of two accounts on one host is the one the agent acts as, and a connection with no rival has no mark. */
  it("marks the account the agent acts as by default", async () => {
    const out = await run(buildListCommand(deps(service(), agents)), ["scout"]);
    expect(out.split("\n")[0]).toMatch(/DEFAULT\s*$/);
    expect(rowOf(out, "conn-first")).toMatch(/yes\s*$/);
    expect(rowOf(out, "conn-second")).toMatch(/no\s*$/);
    expect(rowOf(out, "conn-slack")).toMatch(/—\s*$/);
  });

  /** TEST_SCENARIO: a default picked in the web app or the CLI wins over the earlier grant, in --json too, where it names the host the accounts share. */
  it("follows the picked default, in --json too", async () => {
    const picked = [grants[0]!, { ...grants[1]!, preferred: true }, grants[2]!];
    const out = await run(buildListCommand(deps(service(picked), agents)), [
      "scout",
      "--json",
    ]);
    const rows = JSON.parse(out) as (ConnectionView & {
      default?: { kind: string; scope: string; active: boolean };
    })[];
    expect(Object.fromEntries(rows.map((r) => [r.id, r.default]))).toEqual({
      "conn-first": { kind: "github", scope: "github.ibm.com", active: false },
      "conn-second": { kind: "github", scope: "github.ibm.com", active: true },
      "conn-slack": undefined,
    });
  });
});

describe("dam connection default", () => {
  /** TEST_SCENARIO: the agent's second account on a host becomes the default, by name. */
  it("makes a granted account the default", async () => {
    const svc = service();
    const out = await run(buildDefaultCommand(deps(svc, agents)), [
      "scout",
      "--connection",
      "ghe-second",
    ]);
    expect(svc.setDefault).toHaveBeenCalledWith(
      "agent-00000000000000aa",
      "conn-second",
    );
    expect(out).toContain(
      "scout acts as ghe-second by default on github.ibm.com",
    );
  });

  /** TEST_SCENARIO: a connection the agent does not hold, or one that is not an account a default is picked among, is refused and nothing changes. */
  it.each([
    ["not granted", [grants[0]!, grants[2]!], "ghe-second", "is not granted"],
    ["not an account", grants, "slack", "is not an account"],
    ["unknown", grants, "nope", "unknown connection"],
  ])("refuses a connection that is %s", async (_case, held, ref, message) => {
    const svc = service(held);
    await run(
      buildDefaultCommand(deps(svc, agents)),
      ["scout", "--connection", ref],
      EXIT_INVALID_INPUT,
    );
    expect(svc.setDefault).not.toHaveBeenCalled();
    expect(output.stderr).toContain(message);
  });
});
