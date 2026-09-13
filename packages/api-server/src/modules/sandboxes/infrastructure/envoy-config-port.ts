import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SecretStore } from "../../secret-store/index.js";
import type { AgentRecord } from "../../agents/infrastructure/agent-store.js";
import type { SandboxLayout, SandboxSockets } from "../domain/layout.js";
import type { SandboxLink } from "../domain/network.js";
import {
  buildChains,
  filterByGrants,
  type CredentialSecret,
} from "../domain/chains.js";
import {
  renderEnvoyBootstrap,
  type EnvoyOTelView,
} from "../domain/envoy-bootstrap.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Assembles the paired gateway's configuration and
 * materializes the credentials it injects. The credential bytes are written
 * here and nowhere else, one directory per granted secret. Directories for
 * credentials no longer granted are removed in the same pass, so revoking a
 * grant takes the bytes off the node rather than merely unlinking them from a
 * filter chain.
 */
export interface EnvoyConfigInput {
  record: AgentRecord;
  link: SandboxLink;
  layout: SandboxLayout;
  sockets: SandboxSockets;
}

export interface EnvoyConfigResult {
  config: string;
  hosts: string[];
}

export interface EnvoyConfigPort {
  render(input: EnvoyConfigInput): Promise<EnvoyConfigResult>;
}

export interface EnvoyConfigOpts {
  secrets: SecretStore;
  gatewayPort: number;
  harnessAuthority: string;
  extAuthzHoldSeconds: number;
  objectStore?: { host: string; port: number };
  telemetry?: { host: string; port: number };
  otel: (agentId: string) => EnvoyOTelView;
  log: (message: string, fields?: Record<string, unknown>) => void;
}

const HEALTH_PATH = "/__platform_healthz";
const CREDENTIAL_SDS_NAME = "credential";

export function createEnvoyConfigPort(opts: EnvoyConfigOpts): EnvoyConfigPort {
  return {
    async render({ record, link, layout, sockets }) {
      const owned = await opts.secrets.list({ owner: record.owner });
      const granted: GrantedCredential[] = [];
      for (const { ref, metadata } of filterByGrants(
        owned.map(({ ref, metadata }) => ({
          ref,
          metadata,
          name: nameOf(ref.path),
          labels: metadata.extraLabels ?? {},
          annotations: metadata.extraAnnotations ?? {},
          fieldNames: [],
        })),
        record.spec.grantedSecretIds ?? [],
        record.spec.grantedConnectionIds ?? [],
      )) {
        const fields = (await opts.secrets.get(ref)) ?? {};
        granted.push({
          name: nameOf(ref.path),
          labels: metadata.extraLabels ?? {},
          annotations: metadata.extraAnnotations ?? {},
          fieldNames: Object.keys(fields),
          fields,
        });
      }
      const { chains, warnings } = buildChains(
        granted,
        record.spec.l7Hosts ?? [],
        layout.credentials,
      );
      for (const warning of warnings) {
        opts.log(warning.message, { agentId: record.id, ...warning.fields });
      }

      await materializeCredentials(layout.credentials, granted);

      const config = renderEnvoyBootstrap({
        listenAddress: link.hostAddress,
        port: opts.gatewayPort,
        chains,
        credentialsRoot: layout.credentials,
        credentialSdsName: CREDENTIAL_SDS_NAME,
        leafTlsDir: layout.leafTls,
        harnessAuthority: opts.harnessAuthority,
        harnessSocketPath: sockets.harness,
        ...(opts.objectStore
          ? {
              objectStoreAuthority: `${opts.objectStore.host}:${opts.objectStore.port}`,
              objectStoreHost: opts.objectStore.host,
              objectStorePort: opts.objectStore.port,
            }
          : {}),
        healthPath: HEALTH_PATH,
        extAuthzSocketPath: sockets.extAuthz,
        extAuthzAuthority: record.id,
        extAuthzTimeoutSeconds: opts.extAuthzHoldSeconds + 60,
        telemetry:
          !!opts.telemetry &&
          !chains.some((c) => c.host === opts.telemetry!.host),
        ...(opts.telemetry
          ? {
              telemetryCollectorHost: opts.telemetry.host,
              telemetryCollectorPort: opts.telemetry.port,
            }
          : {}),
        agentId: record.id,
        ...(record.spec.telemetryAttributionId
          ? { attributionId: record.spec.telemetryAttributionId }
          : {}),
        otel: opts.otel(record.id),
      });

      return { config, hosts: chains.map((c) => c.host) };
    },
  };
}

type GrantedCredential = CredentialSecret & { fields: Record<string, string> };

async function materializeCredentials(
  root: string,
  granted: GrantedCredential[],
): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o750 });
  const wanted = new Set(granted.map((s) => `cred-${s.name}`));
  for (const secret of granted) {
    const dir = join(root, `cred-${secret.name}`);
    await mkdir(dir, { recursive: true, mode: 0o750 });
    for (const [key, value] of Object.entries(secret.fields)) {
      if (key.includes("/") || key.includes("..")) continue;
      await writeFile(join(dir, key), value, { mode: 0o640 });
    }
  }
  for (const entry of await readdir(root).catch(() => [])) {
    if (entry.startsWith("cred-") && !wanted.has(entry)) {
      await rm(join(root, entry), { recursive: true, force: true });
    }
  }
}

const nameOf = (refPath: string) => refPath.split("/").pop() ?? refPath;
