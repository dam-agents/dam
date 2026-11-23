import { isAvatarCharacter } from "api-server-api/avatar/svg";
import {
  starterKitApplyInputSchema,
  type StarterKitView,
} from "api-server-api";
import {
  checkKitFlagsOrExit,
  kitErrorDescription,
  kitGrantsOrExit,
  kitRefOf,
  remainingSteps,
  renderSteps,
  resolveKitOrExit,
  type KitService,
} from "../../kit/index.js";
import { parseOrExit } from "../../shared/parse-or-exit.js";
import { printable } from "../../shared/printable.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import {
  defaultProviderLine,
  startsOnLines,
  type AgentView,
} from "../domain/agent-view.js";
import type { AgentService } from "../services/agent-service.js";
import { fetchOrFallback } from "../services/fetch-or-fallback.js";
import type { AvatarUploader } from "../infrastructure/avatar-upload-client.js";
import { avatarFromFlagsOrExit, type AvatarOpts } from "./avatar-flags.js";
import { waitForRunningOrExit } from "./wait-or-exit.js";
import {
  audienceOf,
  sharedConnectionNames,
  sharingUnchecked,
  sharingWarning,
} from "../../sharing/index.js";

export interface KitCreateOpts extends AvatarOpts {
  kit: string;
  commit?: string;
  template?: string;
  connection: string[];
  slackChannel: string[];
  skipSchedule: string[];
  wait?: boolean;
  json?: boolean;
}

export interface KitCreateDeps {
  createAgentService: (host: string) => AgentService;
  createKitService: (host: string) => KitService;
  createAvatarUploader: (host: string) => AvatarUploader;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: `dam agent create --kit` creates the agent the
 * way the web app's kit modal does, through the one kit apply the server
 * offers: the kit's own image, setup and schedules, the connections the
 * user names plus the ones the modal would preselect, and the Slack
 * channels to bind. It then lists what is left to set up, each step with
 * the `dam` command that does it, so a user's agent can finish the setup
 * without the web app.
 */
export async function runCreateFromKit(
  name: string,
  opts: KitCreateOpts,
  ctx: { host: string; timeoutSeconds: number },
  deps: KitCreateDeps,
): Promise<never> {
  const { host } = ctx;
  const kits = deps.createKitService(host);
  const { kit, catalogKits } = await resolveKitOrExit(kits, opts.kit, host);
  checkKitFlagsOrExit(
    kit,
    opts,
    "so the agent is created from the kit you checked",
  );
  const { owned, templates, connectionIds } = await kitGrantsOrExit(
    kits,
    kit,
    opts.connection,
    host,
  );

  const agents = deps.createAgentService(host);
  const avatar =
    (await avatarFromFlagsOrExit(opts, {
      agentService: agents,
      uploader: deps.createAvatarUploader(host),
      host,
    })) ?? (await kitAvatar(kit, agents));
  const input = await parseOrExit(starterKitApplyInputSchema, {
    catalog: kit.catalog,
    kitId: kit.id,
    ...(kit.link && { link: { url: kit.link.url, commit: kit.version } }),
    name,
    ...(avatar && { avatar }),
    ...(opts.template !== undefined && { templateId: opts.template }),
    connectionIds,
    slackChannelIds: opts.slackChannel,
    skipSchedules: opts.skipSchedule,
  });

  const created = await kits.create(input);
  exitOnServiceError(created, host, (error, h) => {
    const described = kitErrorDescription(error, h);
    return {
      ...described,
      stderr: described.stderr.replace(
        /^error: /,
        "error: failed to create agent from the starter kit: ",
      ),
    };
  });
  const { skills, skillsError } = created.value;
  const agent = created.value.agent as AgentView;

  const finalAgent = opts.wait
    ? await waitForRunningOrExit(agents, agent, {
        host,
        name,
        timeoutSeconds: ctx.timeoutSeconds,
        graceSeconds: 0,
        json: opts.json,
        showIdOnError: true,
        refreshContext: "after wait timeout",
      })
    : await fetchOrFallback(agents, agent, "after create");
  const createdAgent: AgentView = {
    ...finalAgent,
    ...(agent.defaultProvider && { defaultProvider: agent.defaultProvider }),
    ...(agent.startsOn && { startsOn: agent.startsOn }),
  };
  const started = agent.startsOn
    ? startsOnLines(agent.startsOn, {
        agentName: finalAgent.name,
        nameOf: (id) => owned?.find((c) => c.id === id)?.name,
      })
    : { out: [], err: [] };
  for (const line of started.err) process.stderr.write(`${line}\n`);

  const granted =
    owned?.filter((c) => input.connectionIds.includes(c.id)) ?? null;
  const steps = remainingSteps(
    kit,
    finalAgent,
    granted,
    owned ?? [],
    templates,
  );
  const kitRef = kitRefOf(kit, catalogKits);
  const audience = audienceOf(finalAgent, []);
  if (granted === null && audience.conversations.length > 0)
    process.stderr.write(
      sharingUnchecked(finalAgent.name, "your connections could not be read"),
    );
  const warning = sharingWarning(finalAgent.name, audience, {
    connections: granted ? sharedConnectionNames(granted) : [],
    satellites: [],
  });
  if (warning) process.stderr.write(warning);

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ agent: createdAgent, kit: kitRef, skills, skillsError, steps })}\n`,
    );
    return process.exit(EXIT_SUCCESS);
  }
  process.stdout.write(
    `✓ Created agent "${finalAgent.name}" (${finalAgent.id}) from the starter kit ${printable(kit.name)} (${kitRef}). State: ${finalAgent.state}.\n`,
  );
  if (agent.defaultProvider)
    process.stdout.write(
      `${defaultProviderLine(
        agent.defaultProvider,
        owned?.find((c) => c.id === agent.defaultProvider!.connectionId)?.name,
      )}\n`,
    );
  for (const line of started.out) process.stdout.write(`${line}\n`);
  if (skillsError)
    process.stderr.write(
      `warning: the kit's external skills could not be installed: ${printable(skillsError)}\n`,
    );
  else if (skills && skills.skipped.length > 0)
    process.stderr.write(
      `warning: ${skills.skipped.length} of the kit's external skills could not be installed; see \`dam skill list ${finalAgent.name}\`\n`,
    );
  process.stdout.write(renderSteps(steps));
  return process.exit(EXIT_SUCCESS);
}

async function kitAvatar(
  kit: Pick<StarterKitView, "avatar">,
  agents: AgentService,
): Promise<string | undefined> {
  if (kit.avatar === undefined || isAvatarCharacter(kit.avatar))
    return kit.avatar;
  const custom = await agents.customAvatarsEnabled();
  return custom.ok && custom.value ? kit.avatar : undefined;
}
