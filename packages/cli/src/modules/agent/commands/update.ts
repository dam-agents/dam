import { Command, Option } from "commander";
import {
  agentUpdateInputSchema,
  type DefaultKind,
  type SessionPair,
} from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { resolveConnectionRef } from "../../connection/index.js";
import type { AgentService } from "../services/agent-service.js";
import {
  readAgentModels,
  type AgentModelsService,
} from "../services/agent-models-service.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import {
  exitOnServiceError,
  printServiceError,
} from "../../shared/trpc/print.js";
import { parseSettingFlags } from "../../shared/setting-flags.js";
import { parseOrExit } from "../../shared/parse-or-exit.js";
import {
  EXIT_AGENT_NOT_RESOLVED,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import type { AvatarUploader } from "../infrastructure/avatar-upload-client.js";
import { renderAvatar } from "../domain/agent-avatar.js";
import type { AgentView } from "../domain/agent-view.js";
import { resolveAgentOrExit } from "./errors.js";
import {
  addAvatarOptions,
  avatarFromFlagsOrExit,
  type AvatarOpts,
} from "./avatar-flags.js";
import {
  isModelProvider,
  modelEntries,
  renderEntries,
} from "../domain/agent-models.js";

const collect = (v: string, acc: string[]): string[] => [...acc, v];

interface UpdateOpts extends AvatarOpts {
  name?: string;
  provider: string[];
  removeProvider: string[];
  harness?: string;
  model?: string;
  setting: string[];
  settingsDefault?: boolean;
  kind: DefaultKind;
  sameAsChat?: boolean;
  server?: string;
  json?: boolean;
}

function invalid(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  return process.exit(EXIT_INVALID_INPUT);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the flags change only what they name. A new
 * model on the same harness keeps the default's settings, and a new harness
 * starts without them, since settings belong to one harness; the server
 * refuses a pair it cannot run and says why.
 */
export function nextDefault(
  current: SessionPair | null,
  fallbackHarness: string | null,
  opts: Pick<UpdateOpts, "harness" | "model" | "settingsDefault">,
  settings: Record<string, string> | undefined,
): SessionPair | null {
  const harness = opts.harness ?? current?.harness ?? fallbackHarness;
  if (harness === null) return null;
  const sameHarness = current?.harness === harness;
  const model = opts.model ?? (sameHarness ? current.model : null);
  const kept = opts.settingsDefault
    ? undefined
    : (settings ?? (sameHarness ? current.settings : undefined));
  return {
    harness,
    provider: null,
    model,
    ...(kept && Object.keys(kept).length > 0 && { settings: kept }),
  };
}

export function buildUpdateCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createAgentModelsService: (host: string) => AgentModelsService;
  createAvatarUploader: (host: string) => AvatarUploader;
}): Command {
  const cmd = new Command("update")
    .description(
      "Change an Agent's name and avatar, which model providers it may use, and the harness and model its sessions start on",
    )
    .argument("<ref>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--name <name>",
      "rename the agent (not `agent-` plus 16 hex characters, the shape of an ID)",
    );
  return addAvatarOptions(cmd, "show")
    .option(
      "--provider <id-or-name>",
      "grant a model-provider connection to the agent (repeatable)",
      collect,
      [] as string[],
    )
    .option(
      "--remove-provider <id-or-name>",
      "take a model-provider connection away from the agent (repeatable)",
      collect,
      [] as string[],
    )
    .option(
      "--harness <name>",
      "harness the default starts sessions on, one the agent carries",
    )
    .option(
      "--model <model>",
      "model the default starts sessions on, as <provider>/<model id> (see `dam agent models`)",
    )
    .option(
      "--setting <id=value>",
      "a per-session setting the default keeps, e.g. effort=high (repeatable; replaces the default's settings)",
      collect,
      [] as string[],
    )
    .option("--settings-default", "drop the default's per-session settings")
    .addOption(
      new Option(
        "--kind <kind>",
        "which default to change: chat (also `dam run`), channel (Slack and Telegram) or scheduled",
      )
        .choices(["chat", "channel", "scheduled"])
        .default("chat"),
    )
    .option(
      "--same-as-chat",
      "with --kind channel or scheduled: drop that default, so it follows the chat default again",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--json",
      "emit the agent as `dam agent get --json` does, with its providers, harnesses and defaults under `models`",
    )
    .addHelpText(
      "after",
      "\nExamples:\n" +
        '  dam agent update my-agent --name "Release helper" --avatar compass\n' +
        "  dam agent update my-agent --avatar-file ./logo.png\n" +
        "  dam agent update my-agent --model ibm/gpt-5.5\n" +
        "  dam agent update my-agent --harness codex --model openai/gpt-5.5 --setting effort=high\n" +
        '  dam agent update my-agent --provider "My provider" --remove-provider conn-123\n' +
        "  dam agent update my-agent --kind scheduled --model ibm/gpt-5-mini\n" +
        "  dam agent update my-agent --kind scheduled --same-as-chat\n",
    )
    .action(async (ref: string, opts: UpdateOpts) => {
      let settings: Record<string, string> | undefined;
      try {
        settings = parseSettingFlags(opts.setting);
      } catch (e) {
        invalid((e as Error).message);
      }
      const pairGiven =
        opts.harness !== undefined ||
        opts.model !== undefined ||
        settings !== undefined ||
        opts.settingsDefault === true;
      const providersGiven =
        opts.provider.length > 0 || opts.removeProvider.length > 0;
      const identityGiven =
        opts.name !== undefined ||
        opts.avatar !== undefined ||
        opts.avatarFile !== undefined ||
        opts.avatarDefault === true;
      if (opts.sameAsChat && opts.kind === "chat")
        invalid("--same-as-chat needs --kind channel or --kind scheduled");
      if (opts.sameAsChat && pairGiven)
        invalid(
          "--same-as-chat drops the default, so it takes no --harness, --model or --setting",
        );
      if (settings && opts.settingsDefault)
        invalid("pass --setting or --settings-default, not both");
      if (!pairGiven && !providersGiven && !opts.sameAsChat && !identityGiven)
        invalid(
          "nothing to change: pass --name, --avatar, --avatar-file, --avatar-default, --provider, --remove-provider, --harness, --model, --setting or --same-as-chat",
        );

      const host = await resolveActiveHost(deps, opts.server);
      const agentService = deps.createAgentService(host);
      let agent = await resolveAgentOrExit(agentService, ref, host);
      const svc = deps.createAgentModelsService(host);

      if (identityGiven)
        agent = await updateIdentityOrExit(agent, opts, {
          agentService,
          uploader: deps.createAvatarUploader(host),
          host,
        });

      if (providersGiven) {
        const all = await svc.connections();
        exitOnServiceError(all, host);
        const idsOf = (refs: readonly string[]): string[] =>
          refs.map((r) => {
            const found = resolveConnectionRef(all.value, r);
            if (!found)
              invalid(
                `unknown connection id or name: ${r}\nhint: run \`dam connection list\` to see ids and names`,
              );
            if (!isModelProvider(found))
              invalid(
                `${r} is not a model-provider connection; grant other connections with \`dam connection grant\``,
              );
            return found.id;
          });
        const updated = await svc.updateProviders(agent.id, {
          grant: idsOf(opts.provider),
          revoke: idsOf(opts.removeProvider),
        });
        exitOnServiceError(updated, host);
      }

      if (opts.sameAsChat && opts.kind !== "chat") {
        const cleared = await svc.clearDefault(agent.id, opts.kind);
        exitOnServiceError(cleared, host);
      } else if (pairGiven) {
        const [saved, status] = await Promise.all([
          svc.savedDefaults(agent.id),
          svc.status(agent.id),
        ]);
        exitOnServiceError(saved, host);
        exitOnServiceError(status, host);
        const current = saved.value[opts.kind] ?? saved.value.chat;
        const pair =
          nextDefault(current, status.value.defaultHarness, opts, settings) ??
          invalid(
            "the agent has not reported its harnesses yet; pass --harness, or wake it (`dam agent restart`) and try again",
          );
        const remembered = await svc.rememberDefault(agent.id, opts.kind, pair);
        exitOnServiceError(remembered, host);
      }

      const models = await readAgentModels(svc, agent.id);
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ ...agent, models })}\n`);
      } else {
        process.stdout.write(
          `✓ Updated ${agent.name}.\n${renderEntries([
            ["NAME", agent.name],
            ["AVATAR", renderAvatar(agent.avatar)],
            ...modelEntries(models),
          ])}`,
        );
      }
      process.exit(EXIT_SUCCESS);
    });
}

async function updateIdentityOrExit(
  agent: AgentView,
  opts: UpdateOpts,
  deps: { agentService: AgentService; uploader: AvatarUploader; host: string },
): Promise<AgentView> {
  const avatar = await avatarFromFlagsOrExit(opts, {
    ...deps,
    current: agent.avatar,
  });
  const input = await parseOrExit(agentUpdateInputSchema, {
    id: agent.id,
    ...(opts.name !== undefined && { name: opts.name }),
    ...(avatar !== undefined && { avatar }),
  });
  const updated = await deps.agentService.updateIdentity(input);
  if (updated.ok) return updated.value;
  if (updated.error.kind === "not-found") {
    process.stderr.write(`error: no agent with id \`${agent.id}\`\n`);
    return process.exit(EXIT_AGENT_NOT_RESOLVED);
  }
  printServiceError(updated.error, deps.host);
  return process.exit(
    updated.error.kind === "transport" &&
      updated.error.serverCode === "CONFLICT"
      ? EXIT_INVALID_INPUT
      : EXIT_RUNTIME_FAILURE,
  );
}
