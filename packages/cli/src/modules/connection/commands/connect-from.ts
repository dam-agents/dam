import {
  type ConnectionView,
  type CredentialCheck,
  type GitHubAppInstallationProbe,
  type GitHubUserTokenProbe,
  connectionNameSchema,
} from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import {
  type ErrorDescription,
  exitOnServiceError,
  serviceErrorDescription,
} from "../../shared/trpc/print.js";
import {
  CONNECTION_ID_PREFIX,
  resolveConnectionRef,
  unresolvedConnectionRef,
} from "../domain/connection-ref.js";
import {
  credentialCheckSummary,
  credentialCheckWarning,
} from "../domain/credential-check.js";
import {
  connectFromHint,
  freeConnectionName,
  nonParentNames,
  parentKindOf,
  parentLabel,
  parentOf,
  scopeFlagsHint,
} from "../domain/github-parent.js";
import {
  type ConnectionScope,
  formatScope,
  hasScopeFlags,
  reachLines,
  resolveAppScope,
  resolveUserTokenScope,
  type ScopeFlags,
  type ScopeKind,
  scopeOf,
  scopeOfSent,
} from "../domain/github-scope.js";
import type { ConnectionService } from "../services/connection-service.js";

export interface ConnectionChoice extends ScopeFlags {
  fullAccess?: boolean;
}

type ParentRef = Pick<ConnectionView, "id" | "name" | "authKind">;

type MakeConnectionError =
  { kind: "input"; message: string } | TransportError | AuthRequiredError;

export type ChildScopeInput = Omit<
  Parameters<ConnectionService["createFromParent"]>[0],
  "parentId" | "name"
>;

export function choosesReach(choice: ConnectionChoice): boolean {
  return choice.fullAccess === true || hasScopeFlags(choice);
}

export async function makeConnection(
  svc: ConnectionService,
  parent: { id: string; kind: ScopeKind },
  name: string,
  choice: ConnectionChoice,
): Promise<Result<{ id: string; sent: ChildScopeInput }, MakeConnectionError>> {
  let scope: Result<ChildScopeInput, string>;
  if (choice.fullAccess) {
    scope = ok({ fullAccess: true });
  } else if (parent.kind === "github-user-token") {
    const probe = await svc.probeGitHubUserToken(parent.id);
    if (!probe.ok) return probe;
    scope = resolveUserTokenScope(probe.value, undefined, choice);
  } else {
    scope = resolveAppScope(undefined, choice);
  }
  if (!scope.ok) return err({ kind: "input", message: scope.error });
  const made = await svc.createFromParent({
    parentId: parent.id,
    name,
    ...scope.value,
  });
  return made.ok ? ok({ id: made.value.id, sent: scope.value }) : made;
}

export function readBackFailure(
  read: Result<ConnectionView | null, TransportError | AuthRequiredError>,
): string | undefined {
  if (!read.ok) return read.error.reason;
  return read.value ? undefined : "it was not found";
}

export function readBackWarning(
  name: string,
  reason: string,
  after: "creating" | "changing",
): string {
  return (
    `warning: couldn't read ${name} back after ${after} it (${reason}), so this shows what was sent; ` +
    "check it with `dam connection list`\n"
  );
}

export function makeConnectionFailure(error: MakeConnectionError): string {
  return error.kind === "input" ? error.message : error.reason;
}

function describeMakeError(
  error: MakeConnectionError,
  host: string,
): ErrorDescription {
  return error.kind === "input"
    ? { stderr: `error: ${error.message}\n`, exitCode: EXIT_INVALID_INPUT }
    : serviceErrorDescription(error, host);
}

export function validateName(name: string): void {
  const nameCheck = connectionNameSchema.safeParse(name);
  if (!nameCheck.success) {
    const msg = nameCheck.error.issues[0]?.message ?? "invalid name";
    process.stderr.write(`error: ${msg}\n`);
    process.exit(EXIT_INVALID_INPUT);
  }
}

export async function connectFrom(args: {
  svc: ConnectionService;
  host: string;
  ref: string;
  name: string | undefined;
  choice: ConnectionChoice;
  json: boolean;
}): Promise<never> {
  const { svc, host, ref, choice, json } = args;
  if (!choosesReach(choice)) {
    process.stderr.write(
      "error: say what the new connection reaches: --account, --repositories, --repository-ids or --permissions, " +
        "or --full-access for everything the sign-in or installation reaches\n",
    );
    process.exit(EXIT_INVALID_INPUT);
  }

  const listed = await svc.list();
  exitOnServiceError(listed, host);
  const parent = resolveParentOrExit(listed.value, ref);
  const taken = nonParentNames(listed.value);
  const name = (args.name ?? freeConnectionName(taken, parent.name)).trim();
  validateName(name);
  if (taken.has(name)) {
    process.stderr.write(
      `error: a connection named '${name}' exists; pass another --name\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }

  const kind = parentKindOf(parent);
  const made = await makeConnection(svc, { id: parent.id, kind }, name, choice);
  exitOnServiceError(made, host, describeMakeError);
  const after = await svc.getConnection(made.value.id);
  const view = after.ok ? after.value : null;
  const failure = readBackFailure(after);
  emitMadeConnection({
    json,
    verb: "Created",
    id: made.value.id,
    name,
    parent,
    kind,
    scope: (view && scopeOf(view)) ?? scopeOfSent(made.value.sent),
    ...(view?.check ? { check: view.check } : {}),
    ...(failure ? { readBackFailure: failure } : {}),
  });
  process.exit(EXIT_SUCCESS);
}

function resolveParentOrExit(
  connections: readonly ConnectionView[],
  ref: string,
): ConnectionView {
  const parents = connections.filter(
    (c) =>
      c.isParent &&
      (ref.startsWith(CONNECTION_ID_PREFIX) ? c.id === ref : c.name === ref),
  );
  if (parents.length === 1) return parents[0]!;
  const other = resolveConnectionRef(connections, ref);
  if (parents.length > 1 || !other) {
    process.stderr.write(unresolvedConnectionRef(connections, ref));
    process.exit(EXIT_INVALID_INPUT);
  }
  const parent = parentOf(connections, other);
  if (parent) {
    process.stderr.write(
      `error: '${other.name}' is a connection made from the ${parentLabel(parent)} ` +
        `${parent.name} (${parent.id}); --from takes the ${parentLabel(parent)} itself\n` +
        `hint:\n${connectFromHint(parent)}`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  process.stderr.write(
    `error: '${other.name}' is not a GitHub sign-in or GitHub App installation; ` +
      "only those make connections\n" +
      "hint: run `dam connection list` to see them\n",
  );
  process.exit(EXIT_INVALID_INPUT);
}

export function emitMadeConnection(args: {
  json: boolean;
  verb: "Created" | "Connected";
  id: string;
  name: string;
  parent: Omit<ParentRef, "id"> & { id: string | undefined };
  kind: ScopeKind;
  scope: ConnectionScope;
  check?: CredentialCheck;
  authUrl?: string;
  presetsApplied?: string[];
  readBackFailure?: string;
}): void {
  if (args.readBackFailure) {
    process.stderr.write(
      readBackWarning(args.name, args.readBackFailure, "creating"),
    );
  }
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        id: args.id,
        name: args.name,
        status: "active",
        authKind: args.parent.authKind,
        ...(args.parent.id ? { parentId: args.parent.id } : {}),
        ...(args.authUrl ? { authUrl: args.authUrl } : {}),
        ...(args.presetsApplied && args.presetsApplied.length > 0
          ? { presetsApplied: args.presetsApplied }
          : {}),
        scope: args.scope,
        ...(args.check ? { check: args.check } : {}),
      })}\n`,
    );
    return;
  }
  process.stdout.write(
    `✓ ${args.verb} ${args.name} (${args.id})` +
      (args.check?.account ? ` as ${args.check.account}` : "") +
      ` from the ${parentLabel(args.parent)} ${args.parent.name}` +
      (args.parent.id ? ` (${args.parent.id})` : "") +
      "\n" +
      `  scope: ${formatScope(args.scope, args.kind)}\n` +
      (args.check ? `  check: ${credentialCheckSummary(args.check)}\n` : ""),
  );
  if (args.scope.fullAccess) {
    process.stderr.write(
      `note: ${args.name} has full access: an agent you grant it to reaches everything ` +
        `the ${parentLabel(args.parent)} ${args.parent.name} reaches.\n` +
        `  Limit it with \`dam connection scope ${args.name} ${scopeFlagsHint(args.kind)}\`.\n`,
    );
  }
  const warning = credentialCheckWarning(args.name, args.check);
  if (warning) process.stderr.write(warning);
}

export async function emitParentOnly(args: {
  svc: ConnectionService;
  json: boolean;
  verb: "Created" | "Connected";
  parent: ParentRef;
  check?: CredentialCheck;
  authUrl?: string;
  presetsApplied?: string[];
  readBackFailure?: string;
}): Promise<void> {
  const { parent } = args;
  if (args.readBackFailure) {
    process.stderr.write(
      readBackWarning(parent.name, args.readBackFailure, "creating"),
    );
  }
  const probed: Result<
    GitHubUserTokenProbe | GitHubAppInstallationProbe,
    TransportError | AuthRequiredError
  > =
    parent.authKind === "github-app"
      ? await args.svc.probeGitHubApp(parent.id)
      : await args.svc.probeGitHubUserToken(parent.id);
  const available = probed.ok ? probed.value : undefined;
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        id: parent.id,
        name: parent.name,
        status: "active",
        authKind: parent.authKind,
        isParent: true,
        ...(args.authUrl ? { authUrl: args.authUrl } : {}),
        ...(args.presetsApplied && args.presetsApplied.length > 0
          ? { presetsApplied: args.presetsApplied }
          : {}),
        ...(available ? { available } : {}),
        ...(args.check ? { check: args.check } : {}),
      })}\n`,
    );
    return;
  }
  process.stdout.write(
    `✓ ${args.verb} the ${parentLabel(parent)} ${parent.name} (${parent.id})` +
      (args.check?.account ? ` as ${args.check.account}` : "") +
      "\n" +
      (available ? `\nIt reaches:\n${reachLines(available).join("\n")}\n` : ""),
  );
  if (!probed.ok) {
    process.stderr.write(
      `note: couldn't read what it reaches: ${probed.error.reason}\n`,
    );
  }
  process.stderr.write(
    `\nNo connection is made from it yet, and it is never granted to an agent itself.\n` +
      `Make a connection from it, limited or with full access:\n${connectFromHint(parent)}`,
  );
  const warning = credentialCheckWarning(parent.name, args.check);
  if (warning) process.stderr.write(warning);
}
