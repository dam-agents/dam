import { describe, it, expect } from "vitest";
import { createGitHubAppEngine } from "../../modules/connections/infrastructure/github-app-engine.js";

/**
 * TEST_OVERVIEW: the connection catalog shows, under a GitHub sign-in, the
 * organizations and accounts its app is installed on. The engine reads them
 * with the sign-in's user token from GitHub's list of the user's
 * installations: each account's login, whether it is an organization, whether
 * the install covers all repositories, whether it is suspended, and an avatar
 * the browser may load. It reads no repositories, so a page of the catalog
 * costs one call per hundred installations.
 */

const NOW_MS = 1_800_000_000_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeEngine(respond: (url: string) => Response) {
  const calls: { url: string; authorization: string | undefined }[] = [];
  const engine = createGitHubAppEngine({
    now: () => NOW_MS,
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        authorization: (init?.headers as Record<string, string> | undefined)
          ?.Authorization,
      });
      return respond(String(url));
    }) as typeof fetch,
  });
  return { engine, calls };
}

const READ = {
  id: "connection:conn-1:github",
  apiBaseUrl: "https://api.github.com",
  accessToken: "ghu_user",
};

describe("where a GitHub sign-in's app is installed", () => {
  it("lists each account with its kind, reach, status and avatar", async () => {
    const { engine, calls } = makeEngine(() =>
      json({
        installations: [
          {
            id: 100,
            target_id: 42,
            target_type: "Organization",
            account: {
              id: 42,
              login: "acme",
              type: "Organization",
              avatar_url: "https://avatars.githubusercontent.com/u/42?v=4",
            },
            repository_selection: "selected",
          },
          {
            id: 200,
            target_id: 43,
            target_type: "User",
            account: { id: 43, login: "octocat", type: "User" },
            repository_selection: "all",
            suspended_at: "2026-11-01T00:00:00Z",
          },
        ],
      }),
    );

    const out = await engine.listUserInstallationAccounts(READ);

    expect(out).toEqual({
      accounts: [
        {
          login: "acme",
          targetId: 42,
          kind: "organization",
          repositorySelection: "selected",
          avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
        },
        {
          login: "octocat",
          targetId: 43,
          kind: "user",
          repositorySelection: "all",
          suspended: true,
        },
      ],
    });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.github.com/user/installations?per_page=100&page=1",
    ]);
    expect(calls[0]!.authorization).toBe("Bearer ghu_user");
  });

  it("says plainly that the app is installed nowhere", async () => {
    const { engine } = makeEngine(() => json({ installations: [] }));
    expect(await engine.listUserInstallationAccounts(READ)).toEqual({
      accounts: [],
    });
  });

  // TEST_SCENARIO: a custom GitHub Enterprise host answers the list, so its avatar address is untrusted: the browser loads it from the catalog page, and only an https URL may reach the page.
  it("drops an avatar that is not an https URL", async () => {
    const { engine } = makeEngine(() =>
      json({
        installations: [
          {
            id: 100,
            target_id: 42,
            account: {
              id: 42,
              login: "acme",
              type: "Organization",
              avatar_url: "javascript:alert(1)",
            },
          },
          {
            id: 101,
            target_id: 44,
            account: {
              id: 44,
              login: "beta",
              type: "Organization",
              avatar_url: "http://ghe.example/avatars/u/44",
            },
          },
        ],
      }),
    );

    const out = await engine.listUserInstallationAccounts(READ);

    expect(out.accounts.map((a) => a.avatarUrl)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("says the list is cut short past three pages", async () => {
    let next = 0;
    const page = () =>
      Array.from({ length: 100 }, () => {
        next += 1;
        return {
          id: next,
          target_id: next,
          account: { id: next, login: `org-${next}` },
        };
      });
    const { engine, calls } = makeEngine(() => json({ installations: page() }));

    const out = await engine.listUserInstallationAccounts(READ);

    expect(out.accounts).toHaveLength(300);
    expect(out.truncated).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("names the sign-in when GitHub refuses the list", async () => {
    const { engine } = makeEngine(() =>
      json({ message: "Bad credentials" }, 401),
    );
    await expect(engine.listUserInstallationAccounts(READ)).rejects.toThrow(
      /connection:conn-1:github: could not list the app installations/,
    );
  });
});
