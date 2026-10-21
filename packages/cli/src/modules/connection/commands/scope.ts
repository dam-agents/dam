import { Command } from "commander";
import type {
  ConnectionView,
  GitHubAppInstallationProbe,
  GitHubUserTokenProbe,
} from "api-server-api";
import type { Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { resolveConnectionRef } from "../domain/connection-ref.js";
import {
  formatScope,
  hasScopeFlags,
  resolveAppScope,
  resolveUserTokenScope,
  type ScopeFlags,
  scopeKindOf,
  scopeOf,
  writePermissions,
} from "../domain/github-scope.js";
import type { ConnectionService } from "../services/connection-service.js";

interface ScopeOpts extends ScopeFlags {
  clear?: boolean;
  server?: string;
  json?: boolean;
}

export function buildScopeCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("scope")
    .description(
      "Show or limit the repositories and permissions a GitHub connection reaches",
    )
    .argument(
      "<id-or-name>",
      "Connection id ('conn-…') or unique name (from `dam connection list`)",
    )
    .option(
      "--account <login>",
      "narrow a GitHub sign-in to the app's installation on this user or organization",
    )
    .option(
      "--repositories <names>",
      "limit to these repository names, space- or comma-separated; empty for every repository",
    )
    .option(
      "--repository-ids <ids>",
      "limit to these numeric repository ids; takes precedence over --repositories",
    )
    .option(
      "--permissions <pairs>",
      "limit to these name:level permissions, e.g. contents:read issues:write; empty for every permission",
    )
    .option("--clear", "remove every limit: the connection reaches all it can")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--json",
      "emit { id, name, kind, scope, available? } as JSON; available lists what can be chosen",
    )
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam connection scope github   # show the scope and what can be chosen\n" +
        "  dam connection scope github --account acme --repositories api,web \\\n" +
        "      --permissions contents:read,pull_requests:write\n" +
        "  dam connection scope my-github-app --repositories api\n" +
        "  dam connection scope github --clear\n" +
        "\nA flag you leave out keeps that part of the current scope.\n" +
        "A GitHub sign-in reaches one account once it is narrowed;\n" +
        "with the app installed on one account only, --account may be left out.\n" +
        "The token never does more than the person who signed in can.\n",
    )
    .action(async (ref: string, opts: ScopeOpts) => {
      const json = opts.json ?? false;
      const host = await resolveActiveHost(deps, opts.server);
      const svc = deps.createConnectionService(host);

      const listed = await svc.list();
      exitOnServiceError(listed, host);
      const match = resolveConnectionRef(listed.value, ref);
      if (!match) {
        process.stderr.write(`error: no connection with id or name '${ref}'\n`);
        process.stderr.write(
          "hint: run `dam connection list` to see ids and names\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }
      const kind = scopeKindOf(match);
      if (!kind) {
        process.stderr.write(
          `error: '${match.name}' is not a GitHub sign-in or GitHub App connection; ` +
            "only those can be limited to repositories and permissions\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }
      if (opts.clear && hasScopeFlags(opts)) {
        process.stderr.write(
          "error: --clear can't be combined with --account, --repositories, --repository-ids or --permissions\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      if (!opts.clear && !hasScopeFlags(opts)) {
        const available: Result<
          GitHubUserTokenProbe | GitHubAppInstallationProbe,
          TransportError | AuthRequiredError
        > =
          kind === "github-user-token"
            ? await svc.probeGitHubUserToken(match.id)
            : await svc.probeGitHubApp(match.id);
        exitOnServiceError(available, host);
        return show(match, kind, available.value, json);
      }

      const current = scopeOf(match);
      if (kind === "github-user-token") {
        let input: Omit<
          Parameters<ConnectionService["updateGitHubUserTokenScope"]>[0],
          "id"
        > = {};
        if (!opts.clear) {
          const probe = await svc.probeGitHubUserToken(match.id);
          exitOnServiceError(probe, host);
          const resolved = resolveUserTokenScope(probe.value, current, opts);
          if (!resolved.ok) {
            process.stderr.write(`error: ${resolved.error}\n`);
            process.exit(EXIT_INVALID_INPUT);
          }
          input = resolved.value;
        }
        const res = await svc.updateGitHubUserTokenScope({
          id: match.id,
          ...input,
        });
        exitOnServiceError(res, host);
      } else {
        const resolved = opts.clear
          ? { ok: true as const, value: {} }
          : resolveAppScope(current, opts);
        if (!resolved.ok) {
          process.stderr.write(`error: ${resolved.error}\n`);
          process.exit(EXIT_INVALID_INPUT);
        }
        const res = await svc.updateGitHubAppScope({
          id: match.id,
          ...resolved.value,
        });
        exitOnServiceError(res, host);
      }

      const after = await svc.getConnection(match.id);
      exitOnServiceError(after, host);
      const scope = after.value ? scopeOf(after.value) : undefined;
      if (json) {
        return writeStdoutAndExit(
          `${JSON.stringify({ ok: true, id: match.id, name: match.name, kind, scope })}\n`,
          EXIT_SUCCESS,
        );
      }
      return writeStdoutAndExit(
        `✓ Scoped ${match.name} (${match.id}): ${formatScope(scope)}\n`,
        EXIT_SUCCESS,
      );
    });
}

function show(
  view: ConnectionView,
  kind: "github-user-token" | "github-app",
  available: GitHubUserTokenProbe | GitHubAppInstallationProbe,
  json: boolean,
): Promise<never> {
  const scope = scopeOf(view);
  if (json) {
    return writeStdoutAndExit(
      `${JSON.stringify({ id: view.id, name: view.name, kind, scope, available })}\n`,
      EXIT_SUCCESS,
    );
  }
  const lines = [`${view.name} (${view.id}): ${formatScope(scope)}`, ""];
  const installations =
    "installations" in available
      ? available.installations
      : [{ accountLogin: undefined, ...available }];
  if (installations.length === 0) {
    lines.push("The app is not installed on any account this sign-in reaches.");
  }
  for (const inst of installations) {
    lines.push(
      inst.accountLogin !== undefined
        ? `Account ${inst.accountLogin}:`
        : "Installation:",
    );
    lines.push(
      `  repositories: ${
        inst.repositoriesUnavailable
          ? `couldn't list (${inst.repositoriesUnavailable})`
          : inst.repositories.map((r) => `${r.name} (${r.id})`).join(", ") +
            (inst.repositoriesTruncated ? ", …" : "")
      }`,
    );
    lines.push(
      `  permissions: ${writePermissions(inst.permissions).replace(/ /g, ", ") || "none"}`,
    );
  }
  if (
    "installationsTruncated" in available &&
    available.installationsTruncated
  ) {
    lines.push("…and more installations than can be listed.");
  }
  return writeStdoutAndExit(`${lines.join("\n")}\n`, EXIT_SUCCESS);
}
