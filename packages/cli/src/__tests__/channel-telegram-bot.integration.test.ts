// TEST_OVERVIEW: `dam channel telegram bot` tells an agent that has only the CLI which Telegram bot this install runs: its username and the `https://t.me/<username>` link a user opens to bind a chat, in the human table and under `--json`. Telegram off, or a bot whose username the server does not know, is said and exits 0, and `--json` gives null for both; the bot is not asked for when Telegram is off.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "api-server-api/router";
import {
  ALL_SCOPES,
  ChannelType,
  type ApiContext,
  type UserIdentity,
} from "api-server-api";
import { runDam } from "./run-dam.js";

const FIXTURE_USER: UserIdentity = {
  sub: "fixture-user",
  preferredUsername: "fixture-user",
  scopes: ALL_SCOPES,
  agentIds: "*",
};

interface Fixture {
  telegram: boolean;
  username: string | null;
}

async function startFixture(
  state: Fixture,
  asked: string[],
): Promise<{ url: string; close: () => Promise<void> }> {
  const ctx = new Proxy(
    {
      channels: {
        get available() {
          asked.push("available");
          return {
            [ChannelType.Slack]: true,
            [ChannelType.Telegram]: state.telegram,
          };
        },
        telegramBotUsername: () => {
          asked.push("telegramBot");
          return state.username;
        },
      },
      terms: { isAccepted: async () => true },
      user: FIXTURE_USER,
    } as Record<string, unknown>,
    {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        if (prop === "then") return undefined;
        throw new Error(
          `fake api-server: unexpected ctx access: ${String(prop)}`,
        );
      },
    },
  ) as unknown as ApiContext;

  const server: Server = createServer(async (req, res) => {
    if (req.url === "/api/version") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ serverVersion: "1.0.0", minClientVersion: "0.0.0" }),
      );
      return;
    }
    if (req.url?.startsWith("/api/trpc/")) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const fetchRes = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req: new Request(`http://localhost${req.url}`, {
          method: req.method!,
          headers: Object.entries(req.headers).reduce<Record<string, string>>(
            (acc, [k, v]) => {
              if (typeof v === "string") acc[k] = v;
              return acc;
            },
            {},
          ),
          body: body && body.length > 0 ? body : undefined,
        }),
        router: appRouter,
        createContext: () => ctx,
      });
      res.writeHead(
        fetchRes.status,
        Object.fromEntries(fetchRes.headers.entries()),
      );
      res.end(Buffer.from(await fetchRes.arrayBuffer()));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) {
    throw new Error("fixture failed to bind");
  }
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("dam channel telegram bot (integration)", () => {
  let home: string;
  let env: Record<string, string>;
  let asked: string[];

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-telegram-bot-"));
    env = { HOME: home, PATH: process.env.PATH ?? "", DAM_TOKEN: "test-token" };
    asked = [];
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  async function run(state: Fixture, args: string[] = []) {
    const fixture = await startFixture(state, asked);
    try {
      const dir = join(home, ".config", "dam");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "config.toml"), `server = "${fixture.url}"\n`);
      return await runDam(["channel", "telegram", "bot", ...args], env);
    } finally {
      await fixture.close();
    }
  }

  /** TEST_SCENARIO: Telegram is on and the bot has a username: the table
   * shows `@<username>` and its t.me link. */
  it("prints the bot's username and t.me link", async () => {
    const r = await run({ telegram: true, username: "dam_test_bot" });

    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(
      "USERNAME        LINK\n" + "@dam_test_bot   https://t.me/dam_test_bot\n",
    );
  });

  /** TEST_SCENARIO: The same under `--json`: enabled, the bare username and
   * the link. */
  it("emits { enabled, username, link } under --json", async () => {
    const r = await run({ telegram: true, username: "dam_test_bot" }, [
      "--json",
    ]);

    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      enabled: true,
      username: "dam_test_bot",
      link: "https://t.me/dam_test_bot",
    });
  });

  /** TEST_SCENARIO: Telegram is off: the command says so on stderr, prints
   * nothing on stdout, exits 0, and never asks for the bot. */
  it("says Telegram is off and exits 0", async () => {
    const r = await run({ telegram: false, username: "stale_bot" });

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("Telegram is not enabled on this host.\n");
    expect(asked).toEqual(["available"]);
  });

  /** TEST_SCENARIO: Telegram is off under `--json`: enabled false, and null
   * for the username and the link. */
  it("gives nulls under --json when Telegram is off", async () => {
    const r = await run({ telegram: false, username: null }, ["--json"]);

    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      enabled: false,
      username: null,
      link: null,
    });
  });

  /** TEST_SCENARIO: Telegram is on, but the bot has not told the server its
   * username: the command says so and exits 0; `--json` gives nulls. */
  it("says the username is not known yet, and exits 0", async () => {
    const human = await run({ telegram: true, username: null });
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toBe("");
    expect(human.stderr).toBe(
      "Telegram is enabled, but the server does not know its bot's username yet.\n",
    );

    const json = await run({ telegram: true, username: null }, ["--json"]);
    expect(json.exitCode, `stderr: ${json.stderr}`).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      enabled: true,
      username: null,
      link: null,
    });
  });
});
