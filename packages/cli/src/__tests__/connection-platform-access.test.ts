// TEST_OVERVIEW: How one Agent calls the platform, set on its grant of the platform's own connection. With --agent the scope command shows it; --as-itself gives the Agent its own identity, with which it can read itself and change nothing, and --as-owner gives it its owner's access again. The flags apply to that one connection and one Agent, and what the server stored is what the command reports.
import { DAM_TEMPLATE_ID, OWN_PLATFORM_ACCESS } from "api-server-api";
import { describe, expect, it, vi } from "vitest";
import type { AgentView } from "../modules/agent/domain/agent-view.js";
import { buildScopeCommand } from "../modules/connection/commands/scope.js";
import type { AgentGrant } from "../modules/connection/domain/default-account.js";
import type { ConnectionService } from "../modules/connection/services/connection-service.js";
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

const HELPER = "agent-000000000000000a";

const helper: AgentView = {
  id: HELPER,
  name: "helper",
  templateId: null,
  image: "",
  state: "running",
  channels: [],
};
const agents = { list: async () => ok([helper]) };

const own = view({
  id: "conn-dam",
  name: "dam",
  templateId: DAM_TEMPLATE_ID,
  authKind: "header",
});

const grant = (itself: boolean): AgentGrant => ({
  connectionId: "conn-dam",
  grantedAt: "2026-11-26T09:00:00Z",
  preferred: false,
  ...(itself && { platformAccess: OWN_PLATFORM_ACCESS }),
});

const service = (...reads: (readonly AgentGrant[])[]) => {
  const agentGrants = vi.fn<ConnectionService["agentGrants"]>();
  for (const read of reads) agentGrants.mockResolvedValueOnce(ok(read));
  return {
    list: async () => ok([own, slack]),
    agentGrants,
    setGrantPlatformAccess: vi.fn(async () => ok(undefined)),
    setGrantToolAccess: vi.fn(async () => ok(undefined)),
  };
};

const scope = (svc: Partial<ConnectionService>) =>
  buildScopeCommand(deps(svc, agents));

describe("dam connection scope --agent on the platform's own connection", () => {
  // TEST_SCENARIO: an owner checks how an Agent calls the platform before changing anything. A grant that stores no access means the Agent acts as its owner, and the command says how to change that.
  it("shows an agent that acts as its owner", async () => {
    const svc = service([grant(false)]);
    const out = await run(scope(svc), ["dam", "--agent", "helper"]);
    expect(out).toBe(
      "dam (conn-dam): helper acts as you: it can do on the platform whatever you can\n",
    );
    expect(output.stderr).toContain("--as-itself");
    expect(svc.setGrantPlatformAccess).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the owner gives the Agent its own identity. The command sends the one access the first step knows, for that Agent's grant alone, and reports what the server stored.
  it("makes an agent call the platform as itself", async () => {
    const svc = service([grant(false)], [grant(true)]);
    const out = await run(scope(svc), [
      "dam",
      "--agent",
      "helper",
      "--as-itself",
    ]);
    expect(svc.setGrantPlatformAccess).toHaveBeenCalledExactlyOnceWith({
      agentId: HELPER,
      connectionId: "conn-dam",
      access: OWN_PLATFORM_ACCESS,
    });
    expect(out).toBe(
      "✓ Set dam (conn-dam): helper acts as itself: it can read itself and change nothing\n",
    );
  });

  // TEST_SCENARIO: the owner takes the Agent off the scale again. The access is cleared, not replaced, so the grant is back to what a new grant is.
  it("gives an agent its owner's access again", async () => {
    const svc = service([grant(true)], [grant(false)]);
    const out = await run(scope(svc), ["dam", "--agent", "helper", "--as-owner"]);
    expect(svc.setGrantPlatformAccess).toHaveBeenCalledExactlyOnceWith({
      agentId: HELPER,
      connectionId: "conn-dam",
      access: null,
    });
    expect(out).toContain("helper acts as you");
  });

  // TEST_SCENARIO: a script reads the result. The JSON names the kind and carries the access as stored, null when the Agent acts as its owner.
  it("emits the stored access as JSON", async () => {
    const svc = service([grant(false)], [grant(true)]);
    const out = await run(scope(svc), [
      "dam",
      "--agent",
      "helper",
      "--as-itself",
      "--json",
    ]);
    expect(JSON.parse(out)).toEqual({
      ok: true,
      id: "conn-dam",
      name: "dam",
      kind: "grant-platform-access",
      agentId: HELPER,
      agentName: "helper",
      platformAccess: OWN_PLATFORM_ACCESS,
    });
  });

  // TEST_SCENARIO: an access needs a grant to sit on. An Agent that does not hold the connection is told so, with the command that grants it, and nothing is sent.
  it("refuses an agent that does not hold the connection", async () => {
    const svc = service([]);
    await run(
      scope(svc),
      ["dam", "--agent", "helper", "--as-itself"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain("helper does not hold dam");
    expect(output.stderr).toContain("dam connection grant helper");
    expect(svc.setGrantPlatformAccess).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the two flags are the two answers to one question, so passing both is a mistake the command names before it asks the server anything.
  it("refuses --as-itself together with --as-owner", async () => {
    const svc = service([grant(false)]);
    await run(
      scope(svc),
      ["dam", "--agent", "helper", "--as-itself", "--as-owner"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain("pass one of them");
    expect(svc.setGrantPlatformAccess).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: only the platform's own connection has this setting. On any other connection, or with no Agent named, the flag is refused and says where it belongs.
  it.each([
    [["slack", "--agent", "helper", "--as-itself"]],
    [["dam", "--as-itself"]],
  ])("refuses the flag where it does not apply: %j", async (args) => {
    const svc = service([grant(false)]);
    await run(scope(svc), args, EXIT_INVALID_INPUT);
    expect(output.stderr).toContain(
      "with --agent <agent> on the platform's own connection",
    );
    expect(svc.setGrantPlatformAccess).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the platform's own connection has neither a scope nor tool access, so a flag that sets one of those is a mistake, not something to ignore.
  it("refuses tool access flags on the platform's own connection", async () => {
    const svc = service([grant(false)]);
    await run(
      scope(svc),
      ["dam", "--agent", "helper", "--write", "ask"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain("neither a scope nor tool access");
    expect(svc.setGrantToolAccess).not.toHaveBeenCalled();
  });
});
