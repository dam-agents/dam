import { describe, expect, it } from "vitest";
import { buildFilesCommand } from "../modules/satellite/commands/files.js";
import type { ConnectDeps } from "../modules/satellite/commands/shared.js";

/**
 * TEST_OVERVIEW: The `dam satellite files` command line, which is the whole
 * documentation a user reads before mounting a directory. The flag is `--write`,
 * because a mount writes as the Agent works rather than uploading a file, the help
 * says where the mount appears and that a files Satellite offers no tools, and it
 * states the three things the user cannot learn afterwards without a lost file:
 * the flag is the whole opt-in, there is no trash, and the root is the whole
 * allowlist.
 */

function command() {
  return buildFilesCommand({} as ConnectDeps);
}

function helpText(): string {
  const files = command();
  let text = "";
  files.configureOutput({
    writeOut: (chunk: string) => {
      text += chunk;
    },
  });
  files.outputHelp();
  return text;
}

describe("dam satellite files", () => {
  /**
   * TEST_SCENARIO: `--upload` belonged to the transfer tools the mount replaces, so
   * a user typing it is told the command does not know it rather than starting a
   * worker that would quietly ignore the intent.
   */
  it("takes --write and no longer takes --upload", () => {
    const files = command();
    expect(files.options.some((option) => option.long === "--write")).toBe(
      true,
    );
    expect(files.options.some((option) => option.long === "--upload")).toBe(
      false,
    );

    files.exitOverride();
    files.configureOutput({ writeErr: () => {} });
    expect(() => files.parse(["node", "dam", "--upload"])).toThrow(
      /unknown option/,
    );
  });

  /**
   * TEST_SCENARIO: The help is the contract a user reads, so it names the mount
   * path, says the Satellite has no tools, and states the read-only default, the
   * missing safety net, the confinement and the ceilings.
   */
  it("describes the mount, the flag and the rules", () => {
    const help = helpText();
    expect(help).toContain("/mnt/sat/<name>");
    expect(help).toContain("--write");
    expect(help).toContain("no tools of its own");
    expect(help).toContain("Read-only file system");
    expect(help).toMatch(/no\s+trash and no undo/);
    expect(help).toContain("1 GiB");
    expect(help).toContain("how many file operations may be in flight at once");
    expect(help).toMatch(/a second worker on the same directory is\s+refused/);
    expect(help).toContain("openat");
    expect(help).not.toContain("--upload");
  });
});
