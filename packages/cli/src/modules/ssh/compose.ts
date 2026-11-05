import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { AgentService } from "../agent/index.js";
import type { EgressService } from "../egress/index.js";
import { buildSshCommand } from "./commands/ssh.js";
import { refuseInHarnessMode } from "../shared/harness-mode.js";

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
  const ssh = buildSshCommand(opts);
  // UNIT_BOUNDARY_DESCRIPTION: a shell is the owner's own door, not the assistant's path.
  ssh.hook("preAction", () => refuseInHarnessMode("ssh"));
  return { commands: [ssh] };
}
