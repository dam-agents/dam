import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { AgentService } from "../agent/index.js";
import type { EgressService } from "../egress/index.js";
import { buildSshCommand } from "./commands/ssh.js";

export interface SshModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
  createEgressService: (host: string) => EgressService;
}

export function composeSshModule(opts: SshModuleOptions): {
  commands: ReadonlyArray<Command>;
} {
  return { commands: [buildSshCommand(opts)] };
}
