// TEST_OVERVIEW: The CLI shows and changes the access of a Slack Account connection, which is read only unless it has full access. `dam connection list` marks the two states in the SCOPE column and in --json. `dam connection scope` shows the state, sets full access only on --full-access and read only on --read-only (setFullAccess), and refuses the GitHub scope flags. --read-only on a connection that offers no such choice is refused.
import { describe, expect, it, vi } from "vitest";
import { buildListCommand } from "../modules/connection/commands/list.js";
import { buildScopeCommand } from "../modules/connection/commands/scope.js";
import type { ConnectionService } from "../modules/connection/services/connection-service.js";
import { EXIT_INVALID_INPUT } from "../modules/shared/exit-codes.js";
import {
  app,
  captureOutput,
  deps,
  ok,
  output,
  run,
  view,
} from "./connection-commands.js";

captureOutput();

const accessChoice = { fullAccessLabel: "Can post as me" };
const readOnlySlack = view({
  id: "conn-slack",
  name: "slack",
  templateId: "slack",
  accessChoice,
});
const postingSlack = view({
  id: "conn-slack-post",
  name: "slack-post",
  templateId: "slack",
  accessChoice,
  fullAccess: true,
});

describe("a Slack Account connection in dam connection list", () => {
  const list = () =>
    buildListCommand(
      deps({ list: async () => ok([readOnlySlack, postingSlack]) }),
    );

  /** TEST_SCENARIO: the owner must see at a glance which Slack Account can post as them, so the table says `read only` for one and FULL ACCESS with the template's own label for the other. */
  it("marks read only and full access", async () => {
    const lines = (await run(list(), [])).split("\n");
    expect(lines.find((l) => l.startsWith("conn-slack "))).toMatch(
      /read only$/,
    );
    expect(lines.find((l) => l.startsWith("conn-slack-post"))).toMatch(
      /FULL ACCESS — Can post as me$/,
    );
  });

  /** TEST_SCENARIO: a script reads the same state from --json, in the scope shape the GitHub connections use. */
  it("adds the access to --json", async () => {
    const rows = JSON.parse(await run(list(), ["--json"]));
    expect(rows.map((r: { scope: unknown }) => r.scope)).toEqual([
      { restricted: true, readOnly: true },
      { restricted: false, fullAccess: true },
    ]);
  });
});

describe("dam connection scope on a Slack Account connection", () => {
  const scope = (svc: Partial<ConnectionService>) =>
    buildScopeCommand(deps(svc));

  /** TEST_SCENARIO: without a flag the command changes nothing and says which state the connection is in and how to change it. */
  it("shows the access and changes nothing", async () => {
    const setFullAccess = vi.fn();
    const out = await run(
      scope({ list: async () => ok([readOnlySlack]), setFullAccess }),
      ["slack"],
    );
    expect(out).toBe("slack (conn-slack): read only\n");
    expect(output.stderr).toContain("dam connection scope slack --full-access");
    expect(setFullAccess).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: posting as the owner is an explicit choice: only --full-access sets it, and the note says what it opens. */
  it("gives full access only with --full-access", async () => {
    const setFullAccess = vi.fn(async () => ok(undefined));
    const out = await run(
      scope({ list: async () => ok([readOnlySlack]), setFullAccess }),
      ["slack", "--full-access"],
    );
    expect(setFullAccess).toHaveBeenCalledWith({
      id: "conn-slack",
      fullAccess: true,
    });
    expect(out).toBe(
      "✓ Scoped slack (conn-slack): FULL ACCESS — Can post as me\n",
    );
    expect(output.stderr).toContain("anyone who can talk to that agent");
  });

  /** TEST_SCENARIO: the owner takes posting away again with --read-only, and --json reports the new scope. */
  it("limits it to reading with --read-only", async () => {
    const setFullAccess = vi.fn(async () => ok(undefined));
    const out = await run(
      scope({ list: async () => ok([postingSlack]), setFullAccess }),
      ["slack-post", "--read-only", "--json"],
    );
    expect(setFullAccess).toHaveBeenCalledWith({
      id: "conn-slack-post",
      fullAccess: false,
    });
    expect(JSON.parse(out)).toEqual({
      ok: true,
      id: "conn-slack-post",
      name: "slack-post",
      kind: "access-choice",
      scope: { restricted: true, readOnly: true },
    });
  });

  /** TEST_SCENARIO: a Slack Account has no repositories or permissions, and cannot be both states at once, so those flags are refused before the server is asked. */
  it("refuses the GitHub scope flags and both states at once", async () => {
    const setFullAccess = vi.fn();
    for (const flags of [
      ["--repositories", "api"],
      ["--full-access", "--read-only"],
    ]) {
      await run(
        scope({ list: async () => ok([readOnlySlack]), setFullAccess }),
        ["slack", ...flags],
        EXIT_INVALID_INPUT,
      );
      expect(output.stderr).toContain("pass --read-only or --full-access");
    }
    expect(setFullAccess).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: --read-only means nothing on a connection that offers no such choice, such as a GitHub App connection, so it is refused instead of ignored. */
  it("refuses --read-only on a connection without the choice", async () => {
    await run(
      scope({ list: async () => ok([app]) }),
      ["my-app", "--read-only"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain("--read-only applies only to");
  });
});
