import {
  AGENT_SCOPES,
  CREDENTIAL_SCOPES,
  DAM_TEMPLATE_ID,
  isGatewayHostname,
  type ApiKeysService,
  type Contribution,
  type Scope,
} from "api-server-api";
import { TRPCError } from "@trpc/server";
import { CONNECTION_TOKEN_PLACEHOLDER } from "./connection-sds.js";
import {
  isIpLiteral,
  parseClusterEndpoint,
} from "./kubernetes-contributions.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Connection that lets an Agent holding it
 * drive this install as its owner. Its upstream is the install's own API host,
 * so the template exists only where that host is one the gateway can inject
 * on: an https URL on a DNS name, not a loopback one. The key is minted by the
 * platform and lives in the Connection's Secret; the Agent holds a placeholder.
 */
export const DAM_SERVER_ENV = "DAM_SERVER";
export const DAM_TOKEN_ENV = "DAM_TOKEN";

export const DAM_KEY_INPUT = "apiKeyId";

const DAM_API_PATH = "/api/";
const DAM_EGRESS_PATH = "/api/*";
const DAM_SKILL_PATH = "$HOME/.agents/skills/dam/SKILL.md";

const LOOPBACK_HOSTS = new Set(["localhost", "localhost.localdomain"]);

export interface DamTarget {
  baseUrl: string;
  host: string;
  port?: number;
}

export function damTargetOf(baseUrl: string): DamTarget | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!isGatewayHostname(url.hostname)) return null;
  if (url.hostname.startsWith("*.")) return null;
  if (isIpLiteral(url.hostname)) return null;
  if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return null;
  const { host, port } = parseClusterEndpoint(url.origin);
  return {
    baseUrl: url.origin,
    host,
    ...(port !== undefined ? { port } : {}),
  };
}

export const DAM_KEY_SCOPES: readonly Scope[] = [
  ...AGENT_SCOPES,
  ...CREDENTIAL_SCOPES,
];

export const damKeyName = (brandName: string) => `${brandName} connection`;

/* UNIT_BOUNDARY_DESCRIPTION: the owner's API keys, as the Connection that drives this install mints, revokes and reads one. `revoke` treats a key that is already revoked as done and throws only when the key store cannot be reached. `ledger` is the record a key is written to before anything uses it: an entry means the key is not a Connection's yet and must be revoked, so a crash anywhere between minting and the Connection naming it costs a key rather than leaving one live and untracked. */
export interface DamKeyPort {
  mint(): Promise<{ id: string; plaintext: string }>;
  revoke(id: string): Promise<void>;
  active(ids: readonly string[]): Promise<ReadonlySet<string>>;
  ledger: DamKeyLedger;
}

export interface DamKeyLedger {
  queue(keyId: string, connectionId: string): Promise<void>;
  settle(keyId: string): Promise<void>;
  pendingFor(connectionId: string): Promise<string[]>;
  forget(connectionId: string): Promise<void>;
}

export interface ApiKeyDirectory {
  activeKeyIds(ids: readonly string[]): Promise<ReadonlySet<string>>;
  ledger: DamKeyLedger;
}

export function damKeyPortFor(
  keys: ApiKeysService,
  directory: ApiKeyDirectory,
  brandName: string,
): DamKeyPort {
  return {
    async mint() {
      const created = await keys.create({
        name: damKeyName(brandName),
        scopes: [...DAM_KEY_SCOPES],
        agentIds: "*",
      });
      return { id: created.key.id, plaintext: created.plaintext };
    },
    async revoke(id) {
      try {
        await keys.revoke(id);
      } catch (err) {
        if (isAlreadyRevoked(err)) return;
        throw err;
      }
    },
    active: (ids) => directory.activeKeyIds(ids),
    ledger: directory.ledger,
  };
}

const isAlreadyRevoked = (err: unknown): boolean =>
  err instanceof TRPCError && err.code === "NOT_FOUND";

export const isDamConnection = (templateId: string) =>
  templateId === DAM_TEMPLATE_ID;

export function damContributions(
  target: DamTarget,
  brandName: string,
): Contribution[] {
  const hostPart = target.port !== undefined ? { port: target.port } : {};
  return [
    {
      kind: "env",
      name: DAM_SERVER_ENV,
      placeholder: target.baseUrl,
    },
    {
      kind: "env",
      name: DAM_TOKEN_ENV,
      placeholder: CONNECTION_TOKEN_PLACEHOLDER,
    },
    {
      kind: "egress-allow",
      host: target.host,
      ...hostPart,
      pathPattern: DAM_EGRESS_PATH,
    },
    {
      kind: "egress-inject",
      host: target.host,
      ...hostPart,
      pathPattern: DAM_API_PATH,
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    },
    {
      kind: "file",
      path: DAM_SKILL_PATH,
      format: "text",
      mergeMode: "overwrite",
      content: damSkill(brandName),
    },
  ];
}

export function damSkill(brand: string): string {
  return `---
name: dam
description: >
  Drive this ${brand} install from inside your own machine with the \`dam\` CLI, which is on your PATH and already acts as the person you work for.
  List, create, configure, restart and schedule their Agents, read their approvals and spend, and read or change their connections, skills and channels.
  Use it whenever the person asks you to do something on ${brand}, or asks what is on it.
---

${brand} runs AI agents in isolated sandboxes on a server.
You are one of them, and \`dam\` is on your PATH: everything the ${brand} web app does has a \`dam\` command, and every command acts as the person you work for.
Run \`dam --help\` for the command groups and \`dam <group> --help\` for one of them.

## Hard rules

1. **You never see a secret.**
   \`DAM_TOKEN\` in your environment is a placeholder that this machine's egress gateway swaps for the real credential on the way out: it works, and it is not the credential.
   Never ask the person for an API key, token, password or key material, and never put one in a command.
   A connection's own secret is entered by the person on a ${brand} page; \`dam connection\` opens it for them.
2. **You act as the person.**
   Your commands carry their access: whatever they can change, you can change.
   Say what you are about to change before you change it, and report what changed.
3. **Their decisions are theirs.**
   Do not decide an approval, accept the Terms of Use, or manage API keys.
   Tell the person what needs deciding instead.
4. **Their own doors are theirs.**
   A live conversation or shell needs their own sign-in rather than this machine's, so \`dam chat\`, \`dam run\`, \`dam ssh\` and a session's stream do not work here.
   Leave that work to them.
5. **Parse \`--json\`, not tables.**
   Read commands take \`--json\`, and an empty list is \`[]\`.
   Table output is for showing to the person.

## What it covers

- **\`dam agent\`** — list, get, create, update, restart, sleep, disable and enable the person's Agents.
- **\`dam schedule\`** — list, create and edit a scheduled task, and run one now.
- **\`dam approval\`** — the queue of decisions the person has to make.
- **\`dam spend\`**, **\`dam metrics\`**, **\`dam telemetry\`** — what an Agent or the person has spent, and a session's turns.
- **\`dam connection\`**, **\`dam skill\`**, **\`dam kit\`**, **\`dam template\`** — what an Agent can use, and what it can be built from.
- **\`dam network\`** — an Agent's standing egress rules; **\`dam channel\`** — its Slack and Telegram bindings.
- **\`dam file\`** — read and write files in an Agent's workspace.
- **\`dam terms\`** — read them for the person; accepting is theirs.

## Examples

\`\`\`sh
dam agent list --json
dam agent get my-agent --json
dam agent create --name notes --template default
dam schedule list my-agent --json
dam connection list --json
\`\`\`
`;
}
