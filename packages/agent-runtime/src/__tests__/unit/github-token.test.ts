/**
 * TEST_OVERVIEW: The skills client sends whatever token the agent holds and
 * lets the gateway swap in the real one. With one GitHub account that is
 * GH_TOKEN; with several, gh's own hosts file names the active account and the
 * env is absent, so the client reads the file instead. With neither it sends
 * the inert placeholder, exactly as before.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INERT_GITHUB_TOKEN,
  resolveGitHubToken,
} from "../../modules/skills/infrastructure/github-token.js";

function homeWithHostsFile(content: string): string {
  const home = mkdtempSync(join(tmpdir(), "gh-token-"));
  mkdirSync(join(home, ".config", "gh"), { recursive: true });
  writeFileSync(join(home, ".config", "gh", "hosts.yml"), content);
  return home;
}

describe("resolveGitHubToken", () => {
  /** TEST_SCENARIO: The single-account case: the env wins over any file. */
  it("prefers GH_TOKEN from the env snapshot", () => {
    const home = homeWithHostsFile(
      "github.com:\n  oauth_token: platform:conn:file\n",
    );
    expect(resolveGitHubToken({ GH_TOKEN: "platform:conn:env" }, home)).toBe(
      "platform:conn:env",
    );
  });

  /** TEST_SCENARIO: Two accounts leave no env; the file's active account token
   * is the one the agent acts as, so the client acts as it too. */
  it("falls back to the active account in gh's hosts file", () => {
    const home = homeWithHostsFile(
      [
        "github.com:",
        "  user: personal",
        "  oauth_token: platform:conn:bbb",
        "  users:",
        "    work: { oauth_token: platform:conn:aaa }",
        "    personal: { oauth_token: platform:conn:bbb }",
      ].join("\n"),
    );
    expect(resolveGitHubToken({}, home)).toBe("platform:conn:bbb");
  });

  /** TEST_SCENARIO: No GitHub Connection at all keeps today's behaviour. */
  it("sends the inert placeholder when nothing names a token", () => {
    const home = mkdtempSync(join(tmpdir(), "gh-token-"));
    expect(resolveGitHubToken({}, home)).toBe(INERT_GITHUB_TOKEN);
  });

  /** TEST_SCENARIO: A hosts file the agent broke by hand must not take the
   * client down with it. */
  it("treats an unreadable hosts file as no token", () => {
    const home = homeWithHostsFile("github.com: [not: valid");
    expect(resolveGitHubToken({}, home)).toBe(INERT_GITHUB_TOKEN);
  });
});
