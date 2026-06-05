import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { AgentService } from "../agent/index.js";
import { buildSshCommand } from "./commands/ssh.js";

export interface SshModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

/** Wires `dam ssh` and its subcommands (`connect`, `configure`, hidden
 *  `_proxy`). The command is mostly a launcher (it hands off to the system
 *  `ssh`/`code`); the networked work happens in the `_proxy` subprocess that
 *  those clients invoke as their ProxyCommand. */
export function composeSshModule(opts: SshModuleOptions): {
  commands: ReadonlyArray<Command>;
} {
  return { commands: [buildSshCommand(opts)] };
}
