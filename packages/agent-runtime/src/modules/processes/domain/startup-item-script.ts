import { join } from "node:path";
import type { StartupItemDeclaration } from "agent-runtime-api";

const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

function shellWord(value: string): string {
  return PLAIN_WORD.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function doubleQuoted(value: string): string {
  return `"${value.replace(/[\\"$`]/g, (c) => `\\${c}`)}"`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The openrc script of a Startup Item a starter kit
 * declared, as the agent would write it by hand. openrc evaluates `command`
 * and `command_args` a second time when it starts the service, so each
 * argument is quoted for that second pass, and the whole value once more for
 * the assignment. A command under `~/` is written with the agent's home in
 * full, so the Processes panel shows the real path. The image's rc.conf
 * supplies the rest: supervision, the work directory and the log.
 */
export function startupItemScript(
  item: StartupItemDeclaration,
  agentHome: string,
  origin: string,
): string {
  const command = item.command.startsWith("~/")
    ? join(agentHome, item.command.slice(2))
    : item.command;
  return [
    "#!/sbin/openrc-run",
    `# ${origin}`,
    ...(item.description
      ? [`description=${doubleQuoted(item.description)}`]
      : []),
    `command=${doubleQuoted(command)}`,
    ...(item.args.length > 0
      ? [`command_args=${doubleQuoted(item.args.map(shellWord).join(" "))}`]
      : []),
    "",
  ].join("\n");
}
