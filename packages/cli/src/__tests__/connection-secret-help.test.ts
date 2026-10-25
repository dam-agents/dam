import { describe, expect, it } from "vitest";
import { runDam } from "./run-dam.js";

/**
 * TEST_OVERVIEW: the `--help` of the commands that store a connection secret.
 * An agent reads `--help` as the authority on a command, so the help must lead
 * it to the secret-entry page: the page is described before the examples, no
 * example reads a secret into the command, and the secret flags sit under
 * their own heading that tells an agent to leave them out.
 */

const SECRETS_HEADING = "Secrets (for scripts; agents leave these out):";
const SCRIPTS_NOTE = "The secret flags are for scripts";

async function help(command: string): Promise<string> {
  const r = await runDam(["connection", command, "--help"], {
    PATH: process.env.PATH ?? "",
  });
  expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
  return r.stdout;
}

function section(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}`);
  expect(start, `no "${heading}" in the help`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n\n", start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

function flagsIn(text: string): string[] {
  return [...text.matchAll(/^ {2}(--[\w-]+)/gm)].map((m) => m[1]!);
}

describe.each([
  {
    command: "connect",
    secretFlags: [
      "--client-secret",
      "--private-key",
      "--value",
      "--access-key-id",
      "--secret-access-key",
    ],
  },
  {
    command: "update",
    secretFlags: ["--value", "--access-key-id", "--secret-access-key"],
  },
])("dam connection $command --help", ({ command, secretFlags }) => {
  // TEST_SCENARIO: no flag description or example reads a key file into the command.
  it("never reads a secret file into the command", async () => {
    expect(await help(command)).not.toMatch(/\$\(cat /);
  });

  // TEST_SCENARIO: the secret flags are listed under their own heading, and each says the page takes the secret when it is left out.
  it("groups the secret flags under the secrets heading", async () => {
    const secrets = section(await help(command), SECRETS_HEADING);
    expect(flagsIn(secrets)).toEqual(secretFlags);
    for (const flag of secretFlags) {
      const entry = secrets
        .slice(secrets.indexOf(`  ${flag}`))
        .split(/\n {2}-/)[0]!;
      expect(entry.replace(/\s+/g, " ")).toMatch(/omit .*DAM web page/);
    }
    const options = section(await help(command), "Options:");
    for (const flag of secretFlags)
      expect(flagsIn(options)).not.toContain(flag);
  });

  // TEST_SCENARIO: the help names the page before the first example, and the examples pass no secret flag — only the note for scripts after them does.
  it("names the page before the examples, which pass no secret", async () => {
    const text = await help(command);
    const examplesAt = text.indexOf("\nExamples:\n");
    expect(examplesAt).toBeGreaterThan(0);
    const intro = text.slice(
      text.lastIndexOf("\n\n", examplesAt - 2),
      examplesAt,
    );
    expect(intro).toContain("DAM web page");
    const notesAt = text.indexOf(SCRIPTS_NOTE, examplesAt);
    expect(notesAt).toBeGreaterThan(examplesAt);
    const examples = text.slice(examplesAt, notesAt);
    for (const flag of secretFlags) {
      expect(examples, `an example passes ${flag}`).not.toContain(`${flag} `);
    }
  });
});
