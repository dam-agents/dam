import { Command, Option } from "commander";
import type {
  ConnectionToolAccess,
  ConnectionView,
  GitHubAppInstallationProbe,
  GitHubUserTokenProbe,
  ToolMode,
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
import {
  formatToolMode,
  parseToolMode,
  TOOL_MODE_FLAG_HINT,
  toolModeNote,
} from "../domain/tool-mode.js";
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
  mode?: string;
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
      "Show or limit the account, repositories and permissions a GitHub connection reaches, " +
        "or show and set the tool mode of an MCP connection, such as a Slack Account",
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
    .option(
      "--mode <mode>",
      "set the tool mode of an MCP connection: allow-all (every tool call passes), " +
        "read-only (only the tools that read pass) or needs-approval (the tools that read pass, every other tool call waits until someone approves it)",
    )
    .addOption(new Option("--clear").hideHelp())
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--json",
      "emit { id, name, kind, scope, parentId?, available?, check? } as JSON; available lists what can be chosen, " +
        'an MCP connection gives { id, name, kind: "tool-mode", toolAccess }, ' +
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
        "  dam connection scope slack                       # show its tool mode\n" +
        "  dam connection scope slack --mode allow-all      # let the agent post as you\n" +
        "  dam connection scope slack --mode read-only      # back to reading only\n" +
        "  dam connection scope my-mcp --mode needs-approval # writes wait for approval\n" +
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
        "`dam connection connect --from <sign-in or installation>`.\n" +
        "\nAn MCP connection has a tool mode: allow all, read only or needs approval.\n" +
        "A Slack Account is read only unless you choose another mode. The platform's\n" +
        "gateway enforces the mode for every agent that holds the connection, from\n" +
        "its next request, whatever the harness. Needs approval is an experimental\n" +
        "feature. An MCP server connected with no auth offers allow all alone.\n" +
        "`dam connection tools <connection>` lists the tools and which ones read.\n",
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
      const mode =
        opts.mode === undefined ? undefined : parseToolMode(opts.mode);
      if (mode === null) {
        process.stderr.write(`error: ${TOOL_MODE_FLAG_HINT}\n`);
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
      if (match.toolAccess) {
        return scopeToolMode(svc, host, match, match.toolAccess, {
          mode,
          other: hasScopeFlags(opts) || opts.fullAccess === true,
          json,
        });
      }
      if (mode !== undefined) {
        process.stderr.write(
          `error: --mode applies only to an MCP connection, such as a Slack Account, not '${match.name}'\n`,
        );
        process.exit(EXIT_INVALID_INPUT);
      }
      const kind = match.isParent ? parentKindOf(match) : scopeKindOf(match);
      if (!kind) {
        process.stderr.write(
          `error: '${match.name}' is not a GitHub sign-in, a GitHub App connection or an MCP connection; ` +
            "only those can be limited\n",
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

async function scopeToolMode(
  svc: ConnectionService,
  host: string,
  match: ConnectionView,
  toolAccess: ConnectionToolAccess,
  opts: { mode: ToolMode | undefined; other: boolean; json: boolean },
): Promise<never> {
  const offered = toolAccess.modes.join("|");
  if (opts.other) {
    process.stderr.write(
      `error: ${match.name} is an MCP connection: it has a tool mode, not a scope; pass --mode ${offered} and no other flag\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  const mode = opts.mode ?? toolAccess.mode;
  if (!toolAccess.modes.includes(mode)) {
    process.stderr.write(
      `error: ${match.name} offers only --mode ${offered}` +
        (toolAccess.modes.length === 1
          ? ": it is an MCP server with no auth, whose requests the gateway does not read\n"
          : "\n"),
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  const changes = opts.mode !== undefined;
  if (changes) {
    const res = await svc.setToolMode({ id: match.id, mode });
    exitOnServiceError(res, host);
  }
  if (opts.json) {
    return writeStdoutAndExit(
      `${JSON.stringify({ ...(changes ? { ok: true } : {}), id: match.id, name: match.name, kind: "tool-mode", toolAccess: { ...toolAccess, mode } })}\n`,
      EXIT_SUCCESS,
    );
  }
  process.stderr.write(toolModeNote(match.name, toolAccess, mode));
  return writeStdoutAndExit(
    `${changes ? "✓ Set " : ""}${match.name} (${match.id}): ${formatToolMode(mode)}\n`,
    EXIT_SUCCESS,
  );
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
