import type { ConnectionView, StarterKitView } from "api-server-api";
import { resolveConnectionRef } from "../../connection/index.js";
import { printServiceError } from "../../shared/trpc/print.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";
import {
  preselectedGrants,
  templateIndex,
  type TemplateIndex,
} from "../domain/kit-plan.js";
import type { KitService } from "../services/kit-service.js";

export interface KitFlags {
  commit?: string;
  connection: string[];
  slackChannel: string[];
  skipSchedule: string[];
}

export interface KitGrants {
  owned: readonly ConnectionView[] | null;
  templates: TemplateIndex;
  connectionIds: string[];
}

function invalid(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  return process.exit(EXIT_INVALID_INPUT);
}

function takesSlackChannels(kit: Pick<StarterKitView, "channels">): boolean {
  return !kit.channels.some(
    (c) => c.type === "slack" && c.conversation === "direct",
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the flags that `dam agent create --kit` and
 * `dam kit apply` share, checked against the kit before anything is sent: a
 * kit from a repository needs the commit `dam kit show` printed and refuses
 * one the repository has moved past, a skipped schedule must be one of the
 * kit's, and a kit that talks in Slack direct messages takes no channel.
 * `why` ends the commit refusal with what the commit is for.
 */
export function checkKitFlagsOrExit(
  kit: StarterKitView,
  opts: KitFlags,
  why: string,
): void {
  if (kit.link) {
    if (opts.commit === undefined)
      invalid(
        `a kit from a repository needs --commit <sha>: the commit \`dam kit show ${kit.link.url}\` printed, ${why}`,
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
      "this starter kit talks in Slack direct messages, not channels; bind a DM instead of passing --slack-channel",
    );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the connections a kit apply grants: each one
 * the user named, by id or name, plus the ones the web app preselects — for
 * each required need that neither a named connection nor one in `held` meets,
 * the one connection the user owns that it accepts. A name that matches
 * nothing, or a GitHub sign-in no agent is granted, exits with an error.
 */
export async function kitGrantsOrExit(
  kits: KitService,
  kit: StarterKitView,
  refs: readonly string[],
  host: string,
  held: readonly string[] = [],
): Promise<KitGrants> {
  const [templatesRes, ownedRes] = await Promise.all([
    kits.connectionTemplates(),
    kits.connections(),
  ]);
  const templates = templateIndex(templatesRes.ok ? templatesRes.value : []);
  const owned = ownedRes.ok ? ownedRes.value : null;
  if (owned === null && refs.some((c) => !c.startsWith("conn-"))) {
    if (!ownedRes.ok) printServiceError(ownedRes.error, host);
    process.stderr.write(
      "hint: naming a connection needs credentials:read; pass --connection <connection-id> instead\n",
    );
    process.exit(EXIT_RUNTIME_FAILURE);
  }
  const named = refs.map((ref) => {
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
    owned === null
      ? []
      : preselectedGrants(kit, owned, [...named, ...held], templates);
  for (const id of preselected) {
    const c = owned!.find((o) => o.id === id)!;
    process.stderr.write(
      `granting ${c.name ?? c.id}: the only connection you have that the kit's required ${c.templateId} connection accepts\n`,
    );
  }
  return {
    owned,
    templates,
    connectionIds: [...new Set([...named, ...preselected])],
  };
}
