import { Command } from "commander";
import { composeAgentModule } from "./modules/agent/compose.js";
import { composeAuthModule } from "./modules/auth/compose.js";
import { composeChatModule } from "./modules/chat/compose.js";
import { composeCliModule } from "./modules/cli/compose.js";
import { composeImportModule } from "./modules/import/compose.js";
import { composeInstanceModule } from "./modules/instance/compose.js";
import { composeTemplateModule } from "./modules/template/compose.js";
import { createTrpcClient } from "./modules/shared/trpc/trpc-client.js";

export interface ComposeOptions {
  /** Override for the production config path (resolved via XDG —
   *  `$XDG_CONFIG_HOME/dam/config.toml`, default
   *  `~/.config/dam/config.toml`). Used by integration tests. */
  configPath?: string;
  /** Override for the production auth-state path (resolved via XDG —
   *  `$XDG_STATE_HOME/dam/auth.toml`, default
   *  `~/.local/state/dam/auth.toml`). Used by integration tests. */
  authPath?: string;
  /** Env consulted for path resolution (`XDG_*`). Defaults to
   *  `process.env`; tests can isolate without monkey-patching. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Package-level wiring. Each bounded context's `compose()` returns its
 * commands (and any cross-module services); this function stitches them
 * into a single commander program. The auth module receives the
 * compat- and config-services it needs via injection — it never imports
 * cli internals directly.
 */
export function compose(opts: ComposeOptions = {}): Command {
  const cli = composeCliModule({ configPath: opts.configPath });
  const auth = composeAuthModule({
    authPath: opts.authPath,
    env: opts.env,
    compatService: cli.services.compatService,
    configService: cli.services.configService,
  });
  const { tokenProvider } = auth.exports;
  const buildTrpc = (host: string) => createTrpcClient({ host, tokenProvider });

  const template = composeTemplateModule({
    buildTrpc,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
  });
  const instance = composeInstanceModule({
    buildTrpc,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    templateService: template.exports.createService,
  });
  const agent = composeAgentModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    serverEnvVar: "DAM_SERVER",
    templateService: template.exports.createService,
    instanceService: instance.exports.createService,
  });
  const chat = composeChatModule({
    buildTrpc,
    compatService: cli.services.compatService,
    configService: cli.services.configService,
    tokenProvider,
    createInstanceService: instance.exports.createService,
  });

  const importModule = composeImportModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    createInstanceService: instance.exports.createService,
    serverEnvVar: "DAM_SERVER",
  });

  const program = new Command();
  program
    .name("dam")
    .description("Command-line client for a Platform deployment")
    .version(cli.cliVersion);

  for (const command of cli.commands) program.addCommand(command);
  for (const command of auth.commands) program.addCommand(command);
  for (const command of template.commands) program.addCommand(command);
  for (const command of instance.commands) program.addCommand(command);
  for (const command of chat.commands) program.addCommand(command);
  for (const command of agent.commands) program.addCommand(command);
  for (const command of importModule.commands) program.addCommand(command);

  return program;
}
