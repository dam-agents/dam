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
import { composeSatelliteModule } from "./modules/satellite/index.js";
import { composeSshModule } from "./modules/ssh/compose.js";
import { composeMetricsModule } from "./modules/metrics/compose.js";
import { composeTelemetryModule } from "./modules/telemetry/compose.js";
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
  const { compatService, configService } = cli.services;
  const auth = composeAuthModule({
    authPath: opts.authPath,
    env: opts.env,
    compatService,
    configService,
  });
  const { tokenProvider } = auth.exports;
  const buildTrpc = (host: string) => createTrpcClient({ host, tokenProvider });

  const template = composeTemplateModule({
    buildTrpc,
    configService,
    compatService,
  });
  const agent = composeAgentModule({
    tokenProvider,
    configService,
    compatService,
    templateService: template.exports.createService,
  });
  const base = {
    tokenProvider,
    configService,
    compatService,
    createAgentService: agent.exports.createService,
  };
  const egress = composeEgressModule(base);

  const program = new Command();
  program
    .name("dam")
    .description("Command-line client for a Platform deployment")
    .version(cli.cliVersion);

  for (const module of [
    cli,
    auth,
    template,
    composeChatModule(base),
    agent,
    composeImportModule(base),
    composeFileModule(base),
    egress,
    composeApprovalModule(base),
    composeConnectionModule({ ...base, browserOpener: createBrowserOpener() }),
    composeScheduleModule(base),
    composeSkillModule(base),
    composeSatelliteModule(base),
    composeSshModule({
      ...base,
      createEgressService: egress.exports.createService,
    }),
    composeChannelModule(base),
    composeMetricsModule(base),
    composeTelemetryModule(base),
    composeTermsModule(base),
  ]) {
    for (const command of module.commands) program.addCommand(command);
  }

  return program;
}
