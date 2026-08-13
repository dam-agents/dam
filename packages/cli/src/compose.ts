import { Command } from "commander";
import { composeAgentModule } from "./modules/agent/compose.js";
import { composeApprovalModule } from "./modules/approval/compose.js";
import { composeAuthModule } from "./modules/auth/compose.js";
import { createBrowserOpener } from "./modules/auth/index.js";
import { composeChannelModule } from "./modules/channel/compose.js";
import { composeChatModule } from "./modules/chat/compose.js";
import { composeCliModule } from "./modules/cli/compose.js";
import { composeConnectionModule } from "./modules/connection/compose.js";
import { composeEgressModule } from "./modules/egress/compose.js";
import { composeFileModule } from "./modules/file/compose.js";
import { composeImportModule } from "./modules/import/compose.js";
import { composeScheduleModule } from "./modules/schedule/compose.js";
import { composeSkillModule } from "./modules/skill/compose.js";
import { composeSshModule } from "./modules/ssh/compose.js";
import { composeMetricsModule } from "./modules/metrics/compose.js";
import { composeTemplateModule } from "./modules/template/compose.js";
import { composeTermsModule } from "./modules/terms/compose.js";
import { createTrpcClient } from "./modules/shared/trpc/trpc-client.js";

export interface ComposeOptions {
  configPath?: string;
  authPath?: string;
  env?: NodeJS.ProcessEnv;
}

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
  const agent = composeAgentModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    serverEnvVar: "DAM_SERVER",
    templateService: template.exports.createService,
  });
  const chat = composeChatModule({
    compatService: cli.services.compatService,
    configService: cli.services.configService,
    tokenProvider,
    createAgentService: agent.exports.createService,
  });

  const importModule = composeImportModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    createAgentService: agent.exports.createService,
    serverEnvVar: "DAM_SERVER",
  });

  const fileModule = composeFileModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    createAgentService: agent.exports.createService,
  });

  const egress = composeEgressModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    createAgentService: agent.exports.createService,
  });

  const approval = composeApprovalModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    createAgentService: agent.exports.createService,
  });

  const connection = composeConnectionModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    createAgentService: agent.exports.createService,
    browserOpener: createBrowserOpener(),
  });

  const schedule = composeScheduleModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    createAgentService: agent.exports.createService,
  });

  const skill = composeSkillModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    createAgentService: agent.exports.createService,
  });

  const ssh = composeSshModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    createAgentService: agent.exports.createService,
    createEgressService: egress.exports.createService,
  });

  const channel = composeChannelModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    createAgentService: agent.exports.createService,
  });

  const metrics = composeMetricsModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
    createAgentService: agent.exports.createService,
  });

  const terms = composeTermsModule({
    tokenProvider: auth.exports.tokenProvider,
    configService: cli.services.configService,
    compatService: cli.services.compatService,
  });

  const program = new Command();
  program
    .name("dam")
    .description("Command-line client for a Platform deployment")
    .version(cli.cliVersion);

  for (const command of cli.commands) program.addCommand(command);
  for (const command of auth.commands) program.addCommand(command);
  for (const command of template.commands) program.addCommand(command);
  for (const command of chat.commands) program.addCommand(command);
  for (const command of agent.commands) program.addCommand(command);
  for (const command of importModule.commands) program.addCommand(command);
  for (const command of fileModule.commands) program.addCommand(command);
  for (const command of egress.commands) program.addCommand(command);
  for (const command of approval.commands) program.addCommand(command);
  for (const command of connection.commands) program.addCommand(command);
  for (const command of schedule.commands) program.addCommand(command);
  for (const command of skill.commands) program.addCommand(command);
  for (const command of ssh.commands) program.addCommand(command);
  for (const command of channel.commands) program.addCommand(command);
  for (const command of metrics.commands) program.addCommand(command);
  for (const command of terms.commands) program.addCommand(command);

  return program;
}
