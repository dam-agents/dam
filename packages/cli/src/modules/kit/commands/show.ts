import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import {
  kitNeeds,
  kitSeeds,
  templateIndex,
  type KitNeed,
  type KitSeed,
} from "../domain/kit-plan.js";
import { kitRefOf, shortKitVersion } from "../domain/kit-ref.js";
import type { KitService } from "../services/kit-service.js";
import { resolveKitOrExit } from "./resolve-kit.js";

export const KIT_REF_HELP =
  "Kit Ref — a kit id from `dam kit list`, `<catalog>/<id>` when two catalogs share it, or a GitHub repository URL";

export function buildShowCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createKitService: (host: string) => KitService;
}): Command {
  return new Command("show")
    .description(
      "Show what a starter kit sets up and what it needs from you, each with the `dam` command that sets it up",
    )
    .argument("<kit>", KIT_REF_HELP)
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--json",
      "emit { ref, kit, seeds, needs } as JSON; each need has kind, required, what, note? and command",
    )
    .addHelpText(
      "after",
      "\nA starter kit is not a template: a template is the image an agent runs,\n" +
        "a kit is a way of working that brings its own setup, skills, connections,\n" +
        "channels and schedules.\n" +
        "\nExamples:\n" +
        "  dam kit show spotlights\n" +
        "  dam kit show https://github.com/acme/research-kit --json\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);
      const svc = deps.createKitService(host);
      const { kit, catalogKits } = await resolveKitOrExit(svc, ref, host);
      const [templates, owned] = await Promise.all([
        svc.connectionTemplates(),
        svc.connections(),
      ]);
      const seeds = kitSeeds(kit);
      const needs = kitNeeds(
        kit,
        templateIndex(templates.ok ? templates.value : []),
        owned.ok ? owned.value : [],
      );
      const kitRef = kitRefOf(kit, catalogKits);

      if (opts.json) {
        return writeStdoutAndExit(
          `${JSON.stringify({ ref: kitRef, kit, seeds, needs })}\n`,
          EXIT_SUCCESS,
        );
      }
      return writeStdoutAndExit(
        renderKit(kitRef, kit, seeds, needs),
        EXIT_SUCCESS,
      );
    });
}

function renderKit(
  ref: string,
  kit: Awaited<ReturnType<typeof resolveKitOrExit>>["kit"],
  seeds: readonly KitSeed[],
  needs: readonly KitNeed[],
): string {
  const lines = [
    `${kit.name} (${ref})`,
    kit.description,
    "",
    `Category: ${kit.category}`,
    `Version:  ${shortKitVersion(kit.version)}`,
  ];
  if (kit.link)
    lines.push(
      `Source:   ${kit.link.url} — not reviewed by anyone on this server; check its install command and environment below`,
    );
  if (kit.docsUrl) lines.push(`Docs:     ${kit.docsUrl}`);
  lines.push("", "Sets up:");
  for (const seed of seeds)
    lines.push(
      `  ${seed.kind.padEnd(11)}${seed.what}${seed.detail ? ` — ${seed.detail}` : ""}`,
    );
  lines.push("", "You set up:");
  if (needs.length === 0) lines.push("  nothing");
  for (const need of needs) {
    lines.push(
      `  ${need.kind.padEnd(11)}${need.what} (${need.required ? "required" : "suggested"})${need.note ? ` — ${need.note}` : ""}`,
      `  ${" ".repeat(11)}${need.command}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
