import { createHash } from "node:crypto";
import type {
  EnvoyCredential,
  EnvoyHostChain,
  EnvoyPathRewrite,
} from "./envoy-bootstrap.js";

/**
 * Which hosts the gateway terminates, and what it injects into each.
 *
 * One chain per host, however many credentials name it: Envoy matches a
 * filter chain by SNI, so two chains for one host would leave the second
 * unreachable. Conflicts between credentials on the same host are resolved
 * first-wins and reported, never merged — a silently merged credential set is
 * how one connection's token ends up on another's upstream.
 */

export const SECRET_TYPE_LABEL = "agent-platform.ai/secret-type";
export const CONNECTION_LABEL = "agent-platform.ai/connection";
export const HOST_PATTERN_ANN = "agent-platform.ai/host-pattern";
export const INJECTION_HTTP2_ANN = "agent-platform.ai/injection-http2";
export const INJECTION_HOSTS_ANN = "agent-platform.ai/injection-hosts";
export const SECRET_TYPE_ALLOW_ONLY = "allow-only";
export const SECRET_TYPE_CONNECTION = "connection";
export const CREDENTIAL_NAME_PREFIX = "platform-cred-";

export interface CredentialSecret {
  name: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  /** Field names present on the secret; values are written out separately. */
  fieldNames: string[];
}

interface HostInjection {
  host?: string;
  headerName?: string;
  queryParamName?: string;
  sdsKey?: string;
  caKey?: string;
  http2?: boolean;
  port?: number;
  upgrades?: boolean;
  pathRewrites?: EnvoyPathRewrite[];
}

export interface ChainWarning {
  message: string;
  fields: Record<string, unknown>;
}

export interface ChainsResult {
  chains: EnvoyHostChain[];
  warnings: ChainWarning[];
}

/** Keeps only the secrets this agent has actually been granted. */
export function filterByGrants<T extends CredentialSecret>(
  secrets: readonly T[],
  grantedSecretIds: readonly string[],
  grantedConnectionIds: readonly string[],
): T[] {
  const secretGrants = new Set(grantedSecretIds.map((s) => s.trim()).filter(Boolean));
  const connectionGrants = new Set(
    grantedConnectionIds.map((s) => s.trim()).filter(Boolean),
  );
  return secrets.filter((s) => {
    switch (s.labels[SECRET_TYPE_LABEL]) {
      case SECRET_TYPE_ALLOW_ONLY:
        return true;
      case SECRET_TYPE_CONNECTION:
        return connectionGrants.has(s.labels[CONNECTION_LABEL] ?? "");
      default:
        return secretGrants.has(stripCredentialPrefix(s.name));
    }
  });
}

export function credentialsRootDir(root: string, secretName: string): string {
  return `${root}/cred-${secretName}`;
}

export function sdsFileKeyForHost(host: string): string {
  return `host-${Buffer.from(host, "utf8").toString("base64url")}.sds.yaml`;
}

export function buildChains(
  secrets: readonly CredentialSecret[],
  l7Hosts: readonly string[],
  credentialsRoot: string,
): ChainsResult {
  const warnings: ChainWarning[] = [];
  const warn = (message: string, fields: Record<string, unknown>) =>
    warnings.push({ message, fields });

  interface Bucket {
    host: string;
    first: string;
    seenHeader: Map<string, string>;
    rewriteByPrefix: Map<string, string>;
    credentials: EnvoyCredential[];
    http2: boolean;
    upgrades: boolean;
    port: number;
    caFile: string;
    pathRewrites: EnvoyPathRewrite[];
  }
  const byHost = new Map<string, Bucket>();
  const order: string[] = [];

  const add = (
    host: string,
    secretName: string,
    credential: EnvoyCredential | null,
    opts: {
      http2?: boolean;
      upgrades?: boolean;
      port?: number;
      caFile?: string;
      pathRewrites?: EnvoyPathRewrite[];
    },
  ) => {
    if (!host) return;
    let bucket = byHost.get(host);
    if (!bucket) {
      bucket = {
        host,
        first: secretName,
        seenHeader: new Map(),
        rewriteByPrefix: new Map(),
        credentials: [],
        http2: false,
        upgrades: false,
        port: 0,
        caFile: "",
        pathRewrites: [],
      };
      byHost.set(host, bucket);
      order.push(host);
    }
    if (opts.http2) bucket.http2 = true;
    if (opts.upgrades) bucket.upgrades = true;
    if (opts.port) {
      if (!bucket.port) bucket.port = opts.port;
      else if (bucket.port !== opts.port) {
        warn("conflicting upstream ports on host; keeping first", {
          host,
          keptPort: bucket.port,
          skippedPort: opts.port,
          skippedSecret: secretName,
        });
      }
    }
    if (opts.caFile) {
      if (!bucket.caFile) bucket.caFile = opts.caFile;
      else if (bucket.caFile !== opts.caFile) {
        warn("conflicting upstream CA files on host; keeping first", {
          host,
          keptCa: bucket.caFile,
          skippedCa: opts.caFile,
          skippedSecret: secretName,
        });
      }
    }
    for (const rewrite of opts.pathRewrites ?? []) {
      const kept = bucket.rewriteByPrefix.get(rewrite.prefix);
      if (kept !== undefined) {
        if (kept !== rewrite.replacement) {
          warn("conflicting path rewrite on host; keeping first", {
            host,
            prefix: rewrite.prefix,
            keptReplacement: kept,
            skippedReplacement: rewrite.replacement,
            skippedSecret: secretName,
          });
        }
        continue;
      }
      bucket.rewriteByPrefix.set(rewrite.prefix, rewrite.replacement);
      bucket.pathRewrites.push(rewrite);
    }
    if (!credential) return;
    const header = credential.headerName || "Authorization";
    const winner = bucket.seenHeader.get(header);
    if (winner !== undefined) {
      warn(
        "duplicate injection header on host; later credential skipped to avoid credential_injector clobber",
        { host, headerName: header, winningSecret: winner, skippedSecret: secretName },
      );
      return;
    }
    bucket.seenHeader.set(header, secretName);
    bucket.credentials.push({ ...credential, headerName: header });
  };

  for (const secret of secrets) {
    switch (secret.labels[SECRET_TYPE_LABEL]) {
      case SECRET_TYPE_CONNECTION: {
        for (const entry of parseInjectionHosts(secret, warn)) {
          if (!entry.host) continue;
          const sdsFileKey = entry.sdsKey || sdsFileKeyForHost(entry.host);
          const caFile = resolveCaFile(secret, entry, credentialsRoot, warn);
          const opts = {
            ...(entry.http2 ? { http2: true } : {}),
            ...(entry.upgrades ? { upgrades: true } : {}),
            ...(entry.port ? { port: entry.port } : {}),
            ...(caFile ? { caFile } : {}),
            pathRewrites: validPathRewrites(secret, entry, warn),
          };
          if (!secret.fieldNames.includes(sdsFileKey)) {
            warn(
              "connection secret is missing its SDS field; rendering host allow-only (no credential injection)",
              { secret: secret.name, host: entry.host, sdsKey: sdsFileKey },
            );
            add(entry.host, secret.name, null, opts);
            continue;
          }
          add(
            entry.host,
            secret.name,
            {
              volumeName: `cred-${secret.name}`,
              sdsFileKey,
              headerName: entry.headerName || "Authorization",
              ...(entry.queryParamName
                ? { queryParamName: entry.queryParamName }
                : {}),
            },
            opts,
          );
        }
        break;
      }
      case SECRET_TYPE_ALLOW_ONLY:
        add(secret.annotations[HOST_PATTERN_ANN] ?? "", secret.name, null, {
          http2: secret.annotations[INJECTION_HTTP2_ANN] === "true",
        });
        break;
    }
  }

  for (const host of l7Hosts) add(host, "l7", null, {});

  const chains = order.map((host) => {
    const bucket = byHost.get(host)!;
    const suffix = `${bucket.first}_${hostShort(host)}`;
    return {
      chainId: `chain_${suffix}`,
      upstreamCluster: `upstream_${suffix}`,
      host,
      credentials: bucket.credentials,
      ...(bucket.http2 ? { http2: true } : {}),
      ...(bucket.upgrades ? { upgrades: true } : {}),
      ...(bucket.port ? { upstreamPort: bucket.port } : {}),
      ...(bucket.caFile ? { upstreamCaFile: bucket.caFile } : {}),
      ...(bucket.pathRewrites.length
        ? { pathRewrites: bucket.pathRewrites }
        : {}),
    };
  });
  return { chains, warnings };
}

function parseInjectionHosts(
  secret: CredentialSecret,
  warn: (message: string, fields: Record<string, unknown>) => void,
): HostInjection[] {
  const raw = secret.annotations[INJECTION_HOSTS_ANN];
  if (!raw) return [];
  let entries: HostInjection[];
  try {
    entries = JSON.parse(raw) as HostInjection[];
  } catch (err) {
    warn("malformed injection-hosts annotation; skipping", {
      secret: secret.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (!entry.host) return false;
    const key = `${entry.host}|${entry.headerName || "Authorization"}`;
    if (seen.has(key)) {
      warn("duplicate (host, header) in injection-hosts; skipping later entry", {
        secret: secret.name,
        host: entry.host,
        headerName: entry.headerName || "Authorization",
      });
      return false;
    }
    seen.add(key);
    return true;
  });
}

function resolveCaFile(
  secret: CredentialSecret,
  entry: HostInjection,
  credentialsRoot: string,
  warn: (message: string, fields: Record<string, unknown>) => void,
): string | null {
  if (!entry.caKey) return null;
  if (/[/\\]/.test(entry.caKey) || entry.caKey.includes("..")) {
    warn("invalid caKey in injection-hosts; ignoring", {
      secret: secret.name,
      host: entry.host,
      caKey: entry.caKey,
    });
    return null;
  }
  if (!secret.fieldNames.includes(entry.caKey)) {
    warn(
      "connection secret is missing its CA field; validating the host against system trust instead",
      { secret: secret.name, host: entry.host, caKey: entry.caKey },
    );
    return null;
  }
  return `${credentialsRootDir(credentialsRoot, secret.name)}/${entry.caKey}`;
}

function validPathRewrites(
  secret: CredentialSecret,
  entry: HostInjection,
  warn: (message: string, fields: Record<string, unknown>) => void,
): EnvoyPathRewrite[] {
  return (entry.pathRewrites ?? []).filter((r) => {
    if (anchoredPath(r.prefix) && anchoredPath(r.replacement)) return true;
    warn("invalid path rewrite in injection-hosts; ignoring", {
      secret: secret.name,
      host: entry.host,
      prefix: r.prefix,
      replacement: r.replacement,
    });
    return false;
  });
}

/** Both ends must be `/`-anchored, so a rewrite cannot escape its prefix. */
const anchoredPath = (p: string) =>
  typeof p === "string" && p.startsWith("/") && p.endsWith("/");

const stripCredentialPrefix = (name: string) =>
  name.startsWith(CREDENTIAL_NAME_PREFIX)
    ? name.slice(CREDENTIAL_NAME_PREFIX.length)
    : name;

/** Chain and cluster names are Envoy identifiers, so the host is digested. */
function hostShort(host: string): string {
  return createHash("sha256").update(host).digest("hex").slice(0, 8);
}
