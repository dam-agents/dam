import {
  AGENT_SCOPES,
  CREDENTIAL_SCOPES,
  DAM_TEMPLATE_ID,
  damKeyName,
  isGatewayHostname,
  type ApiKeysService,
  type Contribution,
  type Scope,
} from "api-server-api";
import { TRPCError } from "@trpc/server";
import { CONNECTION_TOKEN_PLACEHOLDER } from "./connection-sds.js";
import { isIpLiteral } from "./kubernetes-contributions.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Connection that lets an Agent holding it
 * drive this install as its owner. Its upstream is the api-server's own public
 * Service, named over HTTPS: the Agent's gateway terminates that TLS with the
 * install's leaf and takes the request to the Service inside the cluster, so
 * the route works on every install, a plain-HTTP localhost one included. The
 * key is minted by the platform and lives in the Connection's Secret; the Agent
 * holds a placeholder.
 */
export const DAM_SERVER_ENV = "DAM_SERVER";
export const DAM_TOKEN_ENV = "DAM_TOKEN";

export const DAM_KEY_INPUT = "apiKeyId";

const DAM_API_PATH = "/api/";
const DAM_EGRESS_PATH = "/api/*";
const DAM_SKILL_DIR = "$HOME/.agents/skills/dam/";

/* UNIT_BOUNDARY_DESCRIPTION: one file of the `dam` skill the api-server image carries (`skills/dam`), by its path in that folder: `SKILL.md`, or a page beside it such as `references/security-advisory.md`. */
export interface DamSkillFile {
  path: string;
  content: string;
}

export interface DamTarget {
  baseUrl: string;
  host: string;
}

/* UNIT_BOUNDARY_DESCRIPTION: where the Connection points, from the api-server's own public Service address: the Agent names that Service by name over HTTPS, its gateway terminates that TLS with the install's own leaf, and the chain there takes the request to the Service inside the cluster. The name has to be a DNS name the gateway can match on — not a wildcard, not an IP, and never a loopback name, which a gateway pod would resolve to itself. */
export function damTargetOf(apiserverUrl: string): DamTarget | null {
  let url: URL;
  try {
    url = new URL(apiserverUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!isGatewayHostname(host)) return null;
  if (host.startsWith("*.")) return null;
  if (isIpLiteral(host)) return null;
  if (host === "localhost" || host.endsWith(".localhost")) return null;
  return { baseUrl: `https://${host}`, host };
}

export const DAM_KEY_SCOPES: readonly Scope[] = [
  ...AGENT_SCOPES,
  ...CREDENTIAL_SCOPES,
];

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

/* UNIT_BOUNDARY_DESCRIPTION: the skill files as the Connection writes them into the Agent's Skill Path, one file contribution each. */
function damSkillContributions(skill: readonly DamSkillFile[]): Contribution[] {
  return skill.map((file) => ({
    kind: "file" as const,
    path: `${DAM_SKILL_DIR}${file.path}`,
    format: "text" as const,
    mergeMode: "overwrite" as const,
    content: file.content,
  }));
}

const isDamSkillFile = (c: Contribution) =>
  c.kind === "file" && c.path.startsWith(DAM_SKILL_DIR);

/**
 * UNIT_BOUNDARY_DESCRIPTION: the skill the platform hands every Agent that holds
 * this Connection, as the install ships it now: the `dam` skill the api-server
 * serves to a person's own agent, the same files, never a second text. A
 * Connection stores the contributions it was made with, so one made before the
 * skill learned a command would keep teaching the old one; the runtime state is
 * built from the stored contributions, so their skill files are replaced here
 * with the install's — no write, and every install upgrades as its api-server
 * does. An api-server that carries no skill keeps what was stored.
 */
export function currentDamSkill(
  templateId: string,
  contributions: readonly Contribution[],
  skill: readonly DamSkillFile[],
): Contribution[] {
  if (!isDamConnection(templateId) || skill.length === 0)
    return [...contributions];
  return [
    ...contributions.filter((c) => !isDamSkillFile(c)),
    ...damSkillContributions(skill),
  ];
}

export function damContributions(
  target: DamTarget,
  skill: readonly DamSkillFile[],
): Contribution[] {
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
      pathPattern: DAM_EGRESS_PATH,
    },
    {
      kind: "egress-inject",
      host: target.host,
      pathPattern: DAM_API_PATH,
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    },
    ...damSkillContributions(skill),
  ];
}
