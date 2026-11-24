import { Command } from "commander";
import {
  starterKitApplyToAgentInputSchema,
  type StarterKitPartKept,
  type StarterKitView,
} from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { parseOrExit } from "../../shared/parse-or-exit.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { printable } from "../../shared/printable.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import {
  audienceOf,
  sharedConnectionNames,
  sharingUnchecked,
  sharingWarning,
} from "../../sharing/index.js";
import { remainingSteps, shellWord } from "../domain/kit-plan.js";
import { kitRefOf } from "../domain/kit-ref.js";
import { renderSteps } from "../domain/render-steps.js";
import type { KitService } from "../services/kit-service.js";
import {
  checkKitFlagsOrExit,
  kitGrantsOrExit,
  type KitFlags,
} from "./kit-flags.js";
import { kitErrorDescription, resolveKitOrExit } from "./resolve-kit.js";
import { KIT_REF_HELP } from "./show.js";

interface Deps {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createKitService: (host: string) => KitService;
}

type Opts = KitFlags & { server?: string; json?: boolean };

const collect = (v: string, acc: string[]): string[] => [...acc, v];

function keptLine(kept: StarterKitPartKept, agent: string): string {
  const kit = printable(kept.kit);
  switch (kept.part) {
    case "storage":
      return `the kit asks for ${kit} of storage; the agent keeps the size it was created with`;
    case "harness":
      return `the kit runs on ${kit}; the agent keeps its harness — start its sessions on the kit's with \`dam agent update ${agent} --harness <harness>\``;
    case "egress-preset":
      return `the kit asks for the egress preset ${kit}; the agent keeps its network rules, and the kit's own rules are added to them`;
    case "default-model":
      return `the kit starts on the model ${kit}; the agent keeps its default — set it with \`dam agent update ${agent} --model <provider>/${kit}\``;
  }
}

function seedLine(seed: NonNullable<StarterKitView["seed"]>): string {
  const where = seed.into === "home" ? "home" : "work directory";
  return `The kit's repository ${printable(seed.url)} is in the agent's ${where}: checked out, or kept as it was where a checkout of it was already there.\n`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: `dam kit apply` sets a starter kit up on an
 * agent that already exists, through the server's one apply to an existing
 * agent, so the agent keeps its id and with it its channels, artifacts and
 * history. It takes the flags of `dam agent create --kit`, counts the
 * connections the agent already holds toward the kit's needs, says what
 * only a create sets and the agent keeps, and lists what is left to set up.
 * `dam kit update` then works on the agent as on one created from the kit.
 */
export function buildApplyCommand(deps: Deps): Command {
  return new Command("apply")
    .description(
      "Apply a starter kit to an agent that already exists: the agent keeps its id, history, files, artifacts and connections, and gets the kit's setup, schedules and onboarding",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .argument("<kit>", KIT_REF_HELP)
    .option(
      "--commit <sha>",
      "with a kit from a GitHub repository: the full commit `dam kit show` printed; refused when the repository has moved on",
    )
    .option(
      "--connection <id-or-name>",
      "a connection to grant for what the kit needs, repeatable; the agent's own connections count too (see `dam kit show <kit>`)",
      collect,
      [] as string[],
    )
    .option(
      "--slack-channel <channel-id>",
      "a Slack channel to bind, one you and the bot are both in, repeatable",
      collect,
      [] as string[],
    )
    .option(
      "--skip-schedule <name>",
      "leave out one of the kit's schedules, repeatable; needed for one named like a schedule the agent has",
      collect,
      [] as string[],
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--json",
      "emit { agent, kit, kept, skills, skillsError, steps } as JSON",
    )
    .addHelpText(
      "after",
      "\nA kit that runs on its own image applies only at create, and an agent set up from a kit takes its newer versions with `dam kit update`; both are refused.\n" +
        "The kit's repository never overwrites anything: a checkout of it already on the agent is kept as it is, and a home holding one of its files, a work directory that is not empty, or a checkout of another repository refuses the apply, which then changes nothing.\n" +
        "\nExamples:\n" +
        "  dam kit show research\n" +
        "  dam kit apply my-agent research --connection github\n" +
        "  dam kit apply my-agent research --skip-schedule morning-brief\n" +
        "  dam kit apply my-agent https://github.com/acme/desk --commit <sha>\n",
    )
    .action(async (agentRef: string, kitRef: string, opts: Opts) => {
      const host = await resolveActiveHost(deps, opts.server);
      const target = await resolveAgentOrExit(
        deps.createAgentService(host),
        agentRef,
        host,
      );
      const kits = deps.createKitService(host);
      const { kit, catalogKits } = await resolveKitOrExit(kits, kitRef, host);
      checkKitFlagsOrExit(
        kit,
        opts,
        "so the kit applied is the one you checked",
      );
      const heldRes = await kits.grantedConnectionIds(target.id);
      const held = heldRes.ok ? heldRes.value : [];
      const { owned, templates, connectionIds } = await kitGrantsOrExit(
        kits,
        kit,
        opts.connection,
        host,
        held,
      );
      const input = await parseOrExit(starterKitApplyToAgentInputSchema, {
        catalog: kit.catalog,
        kitId: kit.id,
        ...(kit.link && { link: { url: kit.link.url, commit: kit.version } }),
        agentId: target.id,
        connectionIds,
        slackChannelIds: opts.slackChannel,
        skipSchedules: opts.skipSchedule,
      });

      const applied = await kits.applyToAgent(input);
      exitOnServiceError(applied, host, (error, h) => {
        const described = kitErrorDescription(error, h);
        return {
          ...described,
          stderr: described.stderr.replace(
            /^error: /,
            "error: failed to apply the starter kit: ",
          ),
        };
      });
      const { agent, kept, skills, skillsError } = applied.value;

      const added = connectionIds.filter((id) => !held.includes(id));
      const granted =
        owned === null || !heldRes.ok
          ? null
          : owned.filter((c) => held.includes(c.id) || added.includes(c.id));
      const steps = remainingSteps(
        kit,
        agent,
        granted,
        owned ?? [],
        templates,
      ).map((step) =>
        step.kind === "onboarding"
          ? {
              ...step,
              note: "every schedule of the agent, its own included, waits until onboarding finishes",
            }
          : step,
      );
      const ref = kitRefOf(kit, catalogKits);
      const audience = audienceOf(agent, []);
      if (
        owned === null &&
        added.length > 0 &&
        audience.conversations.length > 0
      )
        process.stderr.write(
          sharingUnchecked(agent.name, "your connections could not be read"),
        );
      const warning = sharingWarning(agent.name, audience, {
        connections: sharedConnectionNames(
          owned?.filter((c) => added.includes(c.id)) ?? [],
        ),
        satellites: [],
      });
      if (warning) process.stderr.write(warning);

      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify({ agent, kit: ref, kept, skills, skillsError, steps })}\n`,
        );
        return process.exit(EXIT_SUCCESS);
      }
      const name = printable(agent.name);
      const word = printable(shellWord(agent.name));
      process.stdout.write(
        `✓ Applied the starter kit ${printable(kit.name)} (${ref}) to agent "${name}" (${agent.id}). It keeps its id, history, files, artifacts and connections.\n`,
      );
      if (kit.seed) process.stdout.write(seedLine(kit.seed));
      for (const part of kept)
        process.stderr.write(`warning: ${keptLine(part, word)}\n`);
      if (skillsError)
        process.stderr.write(
          `warning: the kit's external skills could not be installed: ${printable(skillsError)}\n`,
        );
      else if (skills && skills.skipped.length > 0)
        process.stderr.write(
          `warning: ${skills.skipped.length} of the kit's external skills could not be installed; see \`dam skill list ${word}\`\n`,
        );
      process.stdout.write(renderSteps(steps));
      return process.exit(EXIT_SUCCESS);
    });
}
