import type {
  ConnectionAuthKind,
  ConnectionCreateInput,
  ConnectionCredentialUpdate,
  Contribution,
  SecretlessConnectionCreateInput,
  SecretRequestDestination,
  SecretRequestField,
} from "api-server-api";
import { match } from "ts-pattern";
import {
  clientCredentialsIssuer,
  clientCredentialsTarget,
  gitHubAppTarget,
  headerTarget,
  sigv4Target,
} from "./build-connection.js";
import type { ConnectionTemplate } from "./connection-template.js";

export type SecretRequestAuthKind = Extract<
  ConnectionAuthKind,
  "header" | "client-credentials" | "github-app" | "sigv4"
>;

export type PendingSecretRequest =
  | {
      action: "create";
      ownerId: string;
      connection: SecretlessConnectionCreateInput;
      expiresAt: number;
    }
  | {
      action: "update";
      ownerId: string;
      connectionId: string;
      expiresAt: number;
    };

export type SecretRequestOutcome = { ownerId: string } & (
  { status: "saved"; connectionId: string } | { status: "cancelled" }
);

const FIELDS: Record<SecretRequestAuthKind, SecretRequestField[]> = {
  header: [{ name: "value", label: "Secret value" }],
  "client-credentials": [{ name: "clientSecret", label: "Client secret" }],
  "github-app": [
    { name: "privateKey", label: "Private key (PEM)", multiline: true },
  ],
  sigv4: [
    { name: "accessKeyId", label: "Access key ID" },
    { name: "secretAccessKey", label: "Secret access key" },
  ],
};

export function isSecretRequestAuthKind(
  kind: ConnectionAuthKind,
): kind is SecretRequestAuthKind {
  return kind in FIELDS;
}

export function secretFieldsFor(
  kind: SecretRequestAuthKind,
): SecretRequestField[] {
  return FIELDS[kind];
}

export function readSecretFields(
  kind: SecretRequestAuthKind,
  fields: Record<string, string>,
): Record<string, string> {
  const expected = FIELDS[kind].map((f) => f.name);
  const extra = Object.keys(fields).filter((k) => !expected.includes(k));
  if (extra.length > 0) {
    throw new Error(`unexpected field(s): ${extra.join(", ")}`);
  }
  const out: Record<string, string> = {};
  for (const name of expected) {
    const value = fields[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    out[name] = value;
  }
  return out;
}

export function withSecret(
  connection: SecretlessConnectionCreateInput,
  secret: Record<string, string>,
): ConnectionCreateInput {
  return match(connection)
    .with({ authKind: "header" }, (c) => ({ ...c, value: secret.value! }))
    .with({ authKind: "client-credentials" }, (c) => ({
      ...c,
      clientSecret: secret.clientSecret!,
    }))
    .with({ authKind: "github-app" }, (c) => ({
      ...c,
      privateKey: secret.privateKey!,
    }))
    .with({ authKind: "sigv4" }, (c) => ({
      ...c,
      accessKeyId: secret.accessKeyId!,
      secretAccessKey: secret.secretAccessKey!,
    }))
    .exhaustive();
}

export function credentialUpdateOf(
  kind: SecretRequestAuthKind,
  secret: Record<string, string>,
): ConnectionCredentialUpdate {
  return match(kind)
    .with("sigv4", () => ({
      accessKeyId: secret.accessKeyId!,
      secretAccessKey: secret.secretAccessKey!,
    }))
    .with("header", () => ({ value: secret.value! }))
    .with("client-credentials", () => ({ value: secret.clientSecret! }))
    .with("github-app", () => ({ value: secret.privateKey! }))
    .exhaustive();
}

export interface PlannedConnection {
  contributions: Contribution[];
  tokenEndpoint?: { url: string } | { discoveredFrom: string };
}

export function planConnection(
  template: ConnectionTemplate,
  connection: SecretlessConnectionCreateInput,
): PlannedConnection {
  if (template.authKind !== connection.authKind) {
    throw new Error(
      `template ${template.id} expects authKind=${template.authKind}, got ${connection.authKind}`,
    );
  }
  return match(connection)
    .with({ authKind: "header" }, (c) => ({
      contributions: headerTarget(
        template as Extract<ConnectionTemplate, { authKind: "header" }>,
        c,
      ).contributions,
    }))
    .with({ authKind: "client-credentials" }, (c) => {
      const t = template as Extract<
        ConnectionTemplate,
        { authKind: "client-credentials" }
      >;
      const target = clientCredentialsTarget(t, c);
      const issuer = clientCredentialsIssuer(t, c, target.host);
      return {
        contributions: target.contributions,
        tokenEndpoint: issuer
          ? { url: issuer }
          : { discoveredFrom: target.host },
      };
    })
    .with({ authKind: "github-app" }, (c) => {
      const target = gitHubAppTarget(
        template as Extract<ConnectionTemplate, { authKind: "github-app" }>,
        c.host,
      );
      return {
        contributions: target.contributions,
        tokenEndpoint: { url: target.apiBaseUrl },
      };
    })
    .with({ authKind: "sigv4" }, (c) => ({
      contributions: sigv4Target(
        template as Extract<ConnectionTemplate, { authKind: "sigv4" }>,
        c,
      ).contributions,
    }))
    .exhaustive();
}

export function destinationsOf(
  contributions: readonly Contribution[],
): SecretRequestDestination[] {
  const out: SecretRequestDestination[] = [];
  const seen = new Set<string>();
  for (const c of contributions) {
    if (c.kind !== "egress-inject" && c.kind !== "egress-sign") continue;
    const key = `${c.host}:${c.port ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      host: c.host,
      ...(c.port ? { port: c.port } : {}),
      ...(c.kind === "egress-inject"
        ? { headerName: c.headerName, valueFormat: c.valueFormat }
        : { signed: true }),
    });
  }
  return out;
}

export function envNamesOf(contributions: readonly Contribution[]): string[] {
  return [
    ...new Set(
      contributions.flatMap((c) => (c.kind === "env" ? [c.name] : [])),
    ),
  ];
}

export function presetHostsOf(
  template: ConnectionTemplate,
  configInputs?: Record<string, string>,
): Set<string> | null {
  if (!isSecretRequestAuthKind(template.authKind)) return null;
  if (template.authKind === "sigv4") return null;
  const preset = {
    templateId: template.id,
    name: "preset",
    authKind: template.authKind,
    ...(configInputs ? { configInputs } : {}),
  } as SecretlessConnectionCreateInput;
  try {
    return new Set(
      destinationsOf(planConnection(template, preset).contributions).map(
        (d) => d.host,
      ),
    );
  } catch {
    return null;
  }
}

export function unexpectedHostsOf(
  preset: ReadonlySet<string> | null,
  destinations: readonly SecretRequestDestination[],
): string[] {
  if (!preset || preset.size === 0) return [];
  return destinations.map((d) => d.host).filter((h) => !preset.has(h));
}
