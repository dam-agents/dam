import { normalizeGitUrl } from "agent-runtime-api";
import { skillCreateSourceInputSchema } from "api-server-api";
import { describe, expect, it } from "vitest";

// TEST_OVERVIEW: a repository has one identity but many written forms — every form a user can paste must resolve to the same Skill Source, and a pasted directory link must keep pointing at the directory it named.

describe("normalizeGitUrl", () => {
  // TEST_SCENARIO: the forms users actually paste differ only in how the repository is written, so they must collapse onto one git URL — that is what stops one repository from registering as two sources.
  it("resolves every written form of one repository to the same git URL", () => {
    const forms = [
      "github.com/dam-agents/dam",
      "https://github.com/dam-agents/dam",
      "http://github.com/dam-agents/dam",
      "https://github.com/dam-agents/dam/",
      "https://github.com/dam-agents/dam.git",
      "  https://github.com/dam-agents/dam  ",
    ];
    const resolved = forms.map((f) => normalizeGitUrl(f)?.gitUrl);
    expect(resolved).toEqual(
      forms.map(() => "https://github.com/dam-agents/dam"),
    );
  });

  // TEST_SCENARIO: the address-bar link to a skill's folder is the form people share in chat — repository, branch and directory must come apart, because only the directory can be used as the scan location.
  it("separates repository, branch and directory in a browse URL", () => {
    expect(
      normalizeGitUrl(
        "https://github.com/dam-agents/skills/tree/main/skills/html-deck",
      ),
    ).toEqual({
      gitUrl: "https://github.com/dam-agents/skills",
      path: "skills/html-deck",
      ref: "main",
    });
    expect(
      normalizeGitUrl(
        "https://github.com/dam-agents/skills/blob/main/skills/html-deck/SKILL.md",
      ),
    ).toEqual({
      gitUrl: "https://github.com/dam-agents/skills",
      path: "skills/html-deck",
      ref: "main",
    });
  });

  // TEST_SCENARIO: input that names no repository must be refused in the field, rather than creating a source that then fails to scan.
  it("rejects input that does not name a repository", () => {
    expect(normalizeGitUrl("")).toBeNull();
    expect(normalizeGitUrl("not a url")).toBeNull();
    expect(normalizeGitUrl("github.com")).toBeNull();
    expect(normalizeGitUrl("github.com/dam-agents")).toBeNull();
    expect(normalizeGitUrl("ssh://github.com/dam-agents/dam")).toBeNull();
  });

  // TEST_SCENARIO: any other GitHub page of the repository — a pull request, the issues tab — still names one repository, so it resolves to it instead of creating a source that cannot be scanned.
  it("resolves a GitHub page below the repository to the repository", () => {
    expect(
      normalizeGitUrl("https://github.com/dam-agents/dam/pull/12"),
    ).toEqual({ gitUrl: "https://github.com/dam-agents/dam" });
  });
});

describe("skillCreateSourceInputSchema", () => {
  // TEST_SCENARIO: normalization is the server's job, not the caller's, so the CLI and the UI cannot disagree about which forms are accepted.
  it("normalizes the git URL and adopts the directory of a browse URL", () => {
    const parsed = skillCreateSourceInputSchema.parse({
      name: "html deck",
      gitUrl: "github.com/dam-agents/skills/tree/main/skills/html-deck",
    });
    expect(parsed).toEqual({
      name: "html deck",
      gitUrl: "https://github.com/dam-agents/skills",
      path: "skills/html-deck",
    });
  });

  // TEST_SCENARIO: an explicit path is the user's decision about where to scan, so a directory read out of the URL must not overwrite it.
  it("keeps an explicit path over the one in the URL", () => {
    const parsed = skillCreateSourceInputSchema.parse({
      name: "acme",
      gitUrl: "https://github.com/acme/repo/tree/main/skills/one",
      path: ".claude/skills",
    });
    expect(parsed.path).toBe(".claude/skills");
  });
});
