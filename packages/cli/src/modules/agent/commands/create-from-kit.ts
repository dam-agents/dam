import { isAvatarCharacter } from "api-server-api/avatar/svg";
import {
  starterKitApplyInputSchema,
  type StarterKitView,
} from "api-server-api";
import { resolveConnectionRef } from "../../connection/index.js";
import {
  kitErrorDescription,
  kitRefOf,
  preselectedGrants,
  remainingSteps,
  resolveKitOrExit,
  templateIndex,
  type KitService,
  type KitStep,
} from "../../kit/index.js";
import { parseOrExit } from "../../shared/parse-or-exit.js";
import { printable } from "../../shared/printable.js";
import {
  exitOnServiceError,
  printServiceError,
} from "../../shared/trpc/print.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import type { AgentView } from "../domain/agent-view.js";
import type { AgentService } from "../services/agent-service.js";
import { fetchOrFallback } from "../services/fetch-or-fallback.js";
import type { AvatarUploader } from "../infrastructure/avatar-upload-client.js";
import { avatarFromFlagsOrExit, type AvatarOpts } from "./avatar-flags.js";
import { waitForRunningOrExit } from "./wait-or-exit.js";

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

function invalid(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  return process.exit(EXIT_INVALID_INPUT);
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
  if (kit.link) {
    if (opts.commit === undefined)
      invalid(
        `a kit from a repository needs --commit <sha>: the commit \`dam kit show ${kit.link.url}\` printed, so the agent is created from the kit you checked`,
      );
    if (opts.commit.toLowerCase() !== kit.version)
      invalid(
        `${kit.link.url} is at ${kit.version} now, not at ${opts.commit}; run \`dam kit show ${kit.link.url}\` again and check what changed`,
      );
  } else if (opts.commit !== undefined)
    invalid("--commit only goes with a kit from a repository");
  const unknownSchedules = opts.skipSchedule.filter(
    (s) => !kit.schedules.some((k) => k.name === s),
  );
  if (unknownSchedules.length > 0)
    invalid(
      `the starter kit has no schedule ${unknownSchedules.map((s) => `\`${s}\``).join(", ")}; its schedules: ${kit.schedules.map((s) => s.name).join(", ") || "(none)"}`,
    );
  if (opts.slackChannel.length > 0 && !takesSlackChannels(kit))
    invalid(
      "this starter kit talks in Slack direct messages, not channels; bind a DM after create instead of passing --slack-channel",
    );

  const [templatesRes, ownedRes] = await Promise.all([
    kits.connectionTemplates(),
    kits.connections(),
  ]);
  const templates = templateIndex(templatesRes.ok ? templatesRes.value : []);
  const owned = ownedRes.ok ? ownedRes.value : null;
  if (owned === null && opts.connection.some((c) => !c.startsWith("conn-"))) {
    if (!ownedRes.ok) printServiceError(ownedRes.error, host);
    process.stderr.write(
      "hint: naming a connection needs credentials:read; pass --connection <connection-id> instead\n",
    );
    process.exit(EXIT_RUNTIME_FAILURE);
  }
  const named = opts.connection.map((ref) => {
    if (owned === null) return ref;
    const found = resolveConnectionRef(owned, ref);
    if (found === null || found.isParent)
      invalid(
        found
          ? `\`${ref}\` is a GitHub sign-in or installation, which no agent is granted; name a connection made from it (see \`dam connection list\`)`
          : `no connection with id or name '${ref}'; run \`dam connection list\` to see ids and names`,
      );
    return found.id;
  });
  const preselected =
    owned === null ? [] : preselectedGrants(kit, owned, named, templates);
  for (const id of preselected) {
    const c = owned!.find((o) => o.id === id)!;
    process.stderr.write(
      `granting ${c.name ?? c.id}: the only connection you have that the kit's required ${c.templateId} connection accepts\n`,
    );
  }

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
    connectionIds: [...new Set([...named, ...preselected])],
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

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ agent: finalAgent, kit: kitRef, skills, skillsError, steps })}\n`,
    );
    return process.exit(EXIT_SUCCESS);
  }
  process.stdout.write(
    `✓ Created agent "${finalAgent.name}" (${finalAgent.id}) from the starter kit ${printable(kit.name)} (${kitRef}). State: ${finalAgent.state}.\n`,
  );
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

function takesSlackChannels(kit: Pick<StarterKitView, "channels">): boolean {
  return !kit.channels.some(
    (c) => c.type === "slack" && c.conversation === "direct",
  );
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

export function renderSteps(steps: readonly KitStep[]): string {
  const open = steps.filter((s) => s.done !== true);
  if (open.length === 0) return "Nothing is left to set up.\n";
  const lines = ["", "Left to set up:"];
  for (const step of steps) {
    const mark = step.done === null ? "[?]" : step.done ? "[x]" : "[ ]";
    const need = step.required ? "required" : "suggested";
    lines.push(
      `  ${mark} ${step.kind}: ${printable(step.what)} (${need})${step.note ? ` — ${printable(step.note)}` : ""}`,
    );
    if (step.done !== true) lines.push(`      ${printable(step.command)}`);
  }
  return `${lines.join("\n")}\n`;
}
