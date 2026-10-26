import { Command, Option } from "commander";
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
import {
  resolveConnectionRef,
  unresolvedConnectionRef,
} from "../domain/connection-ref.js";
import { credentialCheckSummary } from "../domain/credential-check.js";
import {
  childrenOf,
  connectFromHint,
  parentKindOf,
  parentLabel,
  parentOf,
} from "../domain/github-parent.js";
import {
  FULL_ACCESS_CONFLICT,
  formatScope,
  hasScopeFlags,
  reachLines,
  resolveAppScope,
  resolveUserTokenScope,
  type ScopeFlags,
  type ScopeKind,
  scopeKindOf,
  scopeOf,
  scopeOfSent,
  type SentScope,
} from "../domain/github-scope.js";
import type { ConnectionService } from "../services/connection-service.js";
import { readBackFailure, readBackWarning } from "./connect-from.js";

interface ScopeOpts extends ScopeFlags {
  fullAccess?: boolean;
  clear?: boolean;
  server?: string;
  json?: boolean;
}

type Available = GitHubUserTokenProbe | GitHubAppInstallationProbe;

export function buildScopeCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("scope")
    .description(
      "Show or limit the account, repositories and permissions a GitHub connection reaches",
    )
    .argument(
      "<id-or-name>",
      "Connection id ('conn-…') or unique name (from `dam connection list`); " +
        "a GitHub sign-in or installation shows what it reaches and the connections made from it",
    )
    .option(
      "--account <login>",
      "limit a connection made from a GitHub sign-in to the app's installation on this user or organization",
    )
    .option(
      "--repositories <names>",
      "limit to these repository names, space- or comma-separated; empty lifts the repository limit and keeps the others",
    )
    .option(
      "--repository-ids <ids>",
      "limit to these numeric repository ids; takes precedence over --repositories",
    )
    .option(
      "--permissions <pairs>",
      "limit to these name:level permissions, e.g. contents:read issues:write; empty lifts the permission limit and keeps the others",
    )
    .option(
      "--full-access",
      "remove every limit: the connection reaches every account, repository and permission " +
        "its GitHub sign-in or installation reaches",
    )
    .addOption(new Option("--clear").hideHelp())
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--json",
      "emit { id, name, kind, scope, parentId?, available?, check? } as JSON; available lists what can be chosen, " +
        "check is a GitHub App's credential check of the new scope, as in `dam connection test`; " +
        "a GitHub sign-in or installation gives { id, name, kind, isParent: true, connections, available }",
    )
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam connection scope github   # show the scope and what can be chosen\n" +
        "  dam connection scope github --account acme --repositories api,web \\\n" +
        "      --permissions contents:read,pull_requests:write\n" +
        "  dam connection scope my-github-app --repositories api\n" +
        "  dam connection scope github --full-access\n" +
        "\nA flag you leave out keeps that part of the current scope; on a connection\n" +
        "with full access, it leaves every one of that part.\n" +
        "A connection made from a GitHub sign-in reaches one account once it is limited;\n" +
        "with the app installed on one account only, --account may be left out.\n" +
        "The token never does more than the person who signed in can.\n" +
        "A GitHub App is checked again with a token minted for the new scope.\n" +
        "\nFull access is an explicit choice, never the default: pass --full-access.\n" +
        "A change that would leave a connection with no limit at all is refused.\n" +
        "A GitHub sign-in or GitHub App installation is never granted, so it has no\n" +
        "scope; limit the connections made from it, or make another with\n" +
        "`dam connection connect --from <sign-in or installation>`.\n",
    )
    .action(async (ref: string, opts: ScopeOpts) => {
      const json = opts.json ?? false;
      if (opts.clear) {
        process.stderr.write(
          "error: --clear is gone; a connection reaches everything only when you choose it:\n" +
            "  pass --full-access for that, or the scope flags to limit the connection\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }
      if (opts.fullAccess && hasScopeFlags(opts)) {
        process.stderr.write(`error: ${FULL_ACCESS_CONFLICT}\n`);
        process.exit(EXIT_INVALID_INPUT);
      }
      const host = await resolveActiveHost(deps, opts.server);
      const svc = deps.createConnectionService(host);

      const listed = await svc.list();
      exitOnServiceError(listed, host);
      const match = resolveConnectionRef(listed.value, ref);
      if (!match) {
        process.stderr.write(unresolvedConnectionRef(listed.value, ref));
        process.exit(EXIT_INVALID_INPUT);
      }
      const kind = match.isParent ? parentKindOf(match) : scopeKindOf(match);
      if (!kind) {
        process.stderr.write(
          `error: '${match.name}' is not a GitHub sign-in or GitHub App connection; ` +
            "only those can be limited to repositories and permissions\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }
      const changes = opts.fullAccess === true || hasScopeFlags(opts);

      if (match.isParent) {
        const children = childrenOf(listed.value, match.id);
        if (changes) {
          process.stderr.write(
            `error: ${match.name} (${match.id}) is a ${parentLabel(match)}; ` +
              "it is never granted, so it has no scope to change\n" +
              connectionsLine(children) +
              (children.length > 0
                ? "hint: limit one of them with `dam connection scope <connection> …`, or make another:\n"
                : "hint: make one:\n") +
              connectFromHint(match),
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        const available = await probe(svc, match.id, kind);
        exitOnServiceError(available, host);
        return showParent(match, kind, children, available.value, json);
      }

      if (!changes) {
        const available = await probe(svc, match.id, kind);
        exitOnServiceError(available, host);
        return show(
          match,
          kind,
          parentOf(listed.value, match),
          available.value,
          json,
        );
      }

      const current = scopeOf(match);
      let sent: SentScope;
      if (kind === "github-user-token") {
        let input: Omit<
          Parameters<ConnectionService["updateGitHubUserTokenScope"]>[0],
          "id"
        > = { fullAccess: true };
        if (!opts.fullAccess) {
          const probed = await svc.probeGitHubUserToken(match.id);
          exitOnServiceError(probed, host);
          const resolved = resolveUserTokenScope(probed.value, current, opts);
          if (!resolved.ok) {
            process.stderr.write(`error: ${resolved.error}\n`);
            process.exit(EXIT_INVALID_INPUT);
          }
          input = resolved.value;
        }
        sent = input;
        const res = await svc.updateGitHubUserTokenScope({
          id: match.id,
          ...input,
        });
        exitOnServiceError(res, host);
      } else {
        const resolved = opts.fullAccess
          ? { ok: true as const, value: { fullAccess: true } }
          : resolveAppScope(current, opts);
        if (!resolved.ok) {
          process.stderr.write(`error: ${resolved.error}\n`);
          process.exit(EXIT_INVALID_INPUT);
        }
        sent = resolved.value;
        const res = await svc.updateGitHubAppScope({
          id: match.id,
          ...resolved.value,
        });
        exitOnServiceError(res, host);
      }

      const after = await svc.getConnection(match.id);
      const view = after.ok ? after.value : null;
      const failure = readBackFailure(after);
      if (failure) {
        process.stderr.write(readBackWarning(match.name, failure, "changing"));
      }
      const scope = (view && scopeOf(view)) ?? scopeOfSent(sent);
      const check = kind === "github-app" ? view?.check : undefined;
      if (json) {
        return writeStdoutAndExit(
          `${JSON.stringify({ ok: true, id: match.id, name: match.name, kind, scope, ...(check ? { check } : {}) })}\n`,
          EXIT_SUCCESS,
        );
      }
      if (scope.fullAccess) {
        process.stderr.write(
          `note: ${match.name} has full access: an agent you grant it to reaches everything ` +
            "its sign-in or installation reaches\n",
        );
      }
      return writeStdoutAndExit(
        `✓ Scoped ${match.name} (${match.id}): ${formatScope(scope, kind)}\n` +
          (check ? `  check: ${credentialCheckSummary(check)}\n` : ""),
        EXIT_SUCCESS,
      );
    });
}

function probe(
  svc: ConnectionService,
  id: string,
  kind: ScopeKind,
): Promise<Result<Available, TransportError | AuthRequiredError>> {
  return kind === "github-user-token"
    ? svc.probeGitHubUserToken(id)
    : svc.probeGitHubApp(id);
}

function connectionsLine(children: readonly ConnectionView[]): string {
  return children.length > 0
    ? `  Connections made from it: ${children.map((c) => `${c.name} (${c.id})`).join(", ")}\n`
    : "  No connection is made from it yet.\n";
}

function show(
  view: ConnectionView,
  kind: ScopeKind,
  parent: ConnectionView | undefined,
  available: Available,
  json: boolean,
): Promise<never> {
  const scope = scopeOf(view);
  if (json) {
    return writeStdoutAndExit(
      `${JSON.stringify({ id: view.id, name: view.name, kind, scope, ...(view.parentId ? { parentId: view.parentId } : {}), available })}\n`,
      EXIT_SUCCESS,
    );
  }
  const lines = [
    `${view.name} (${view.id}): ${formatScope(scope, kind)}`,
    ...(parent
      ? [`Made from the ${parentLabel(parent)} ${parent.name} (${parent.id}).`]
      : []),
    "",
    ...reachLines(available),
  ];
  return writeStdoutAndExit(`${lines.join("\n")}\n`, EXIT_SUCCESS);
}

function showParent(
  parent: ConnectionView,
  kind: ScopeKind,
  children: readonly ConnectionView[],
  available: Available,
  json: boolean,
): Promise<never> {
  if (json) {
    const connections = children.map((c) => ({
      id: c.id,
      name: c.name,
      scope: scopeOf(c),
    }));
    return writeStdoutAndExit(
      `${JSON.stringify({ id: parent.id, name: parent.name, kind, isParent: true, connections, available })}\n`,
      EXIT_SUCCESS,
    );
  }
  const lines = [
    `${parent.name} (${parent.id}): ${parentLabel(parent)}, never granted itself`,
    ...(children.length > 0
      ? [
          "Connections made from it:",
          ...children.map(
            (c) =>
              `  ${c.name} (${c.id}): ${formatScope(scopeOf(c), scopeKindOf(c) ?? kind)}`,
          ),
        ]
      : ["No connection is made from it yet."]),
    "",
    "It reaches:",
    ...reachLines(available),
  ];
  process.stderr.write(
    `hint: make ${children.length > 0 ? "another" : "a"} connection from it:\n${connectFromHint(parent)}`,
  );
  return writeStdoutAndExit(`${lines.join("\n")}\n`, EXIT_SUCCESS);
}
