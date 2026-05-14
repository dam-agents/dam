import { intro, outro } from "@clack/prompts";
import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { InstanceService } from "../../instance/index.js";
import type { TemplateService } from "../../template/index.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

/**
 * Deps for `dam agent create`. Mirrors `dam instance create`'s shape so
 * the orchestration verbs added in issues 003–006 can drop in without
 * widening the interface.
 */
export interface CreateAgentCommandDeps {
  compatService: CompatService;
  configService: ConfigService;
  createInstanceService: (host: string) => InstanceService;
  createTemplateService: (host: string) => TemplateService;
  createTrpcClient: (host: string) => TrpcClient;
  serverEnvVar: string;
}

interface CliOpts {
  server?: string;
}

export function buildCreateCommand(_deps: CreateAgentCommandDeps): Command {
  return new Command("create")
    .description("Interactively create an agent and a running instance")
    .option("--server <url>", "override the configured server URL for this call")
    .action(async (opts: CliOpts) => {
      await runCreate(opts);
    });
}

async function runCreate(_opts: CliOpts): Promise<void> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "error: dam agent create requires an interactive terminal; use `dam instance create` for scripted setup\n",
    );
    process.exit(1);
  }

  intro("dam agent create");
  outro("nothing to do yet — full flow lands in subsequent issues");
}
