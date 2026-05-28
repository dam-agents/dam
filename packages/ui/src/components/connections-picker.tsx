import type { AppConnectionView } from "api-server-api";
import { Globe, Info, KeyRound, Lock, Sparkles } from "lucide-react";

import type { SecretView } from "../types.js";
import {
  isMcpSecret,
  isProviderPresetType,
  mcpHostnameFromSecretName,
} from "../types.js";
import { AppStatusPill } from "./app-status-pill.js";
import { HoverTooltip } from "./hover-tooltip.js";

/**
 * One row in the picker's "OAuth Apps" subsection. Joins the
 * api-server-managed app connection (hosts, displayName, expiry, appId
 * for the brand icon) with the K8s credential Secret's id (the grant
 * target — agents see the token via Envoy injection on every host).
 */
export interface OAuthAppEntry {
  secretId: string;
  appId: string;
  displayName: string;
  /** Non-empty; rendered comma-joined under the displayName. */
  hosts: string[];
  expired: boolean;
}

export function ConnectionsHeader() {
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-bold text-text-secondary uppercase tracking-[0.03em]">
      Connections
      <HoverTooltip
        trigger={
          <Info
            size={13}
            className="text-text-muted hover:text-text-secondary cursor-help"
          />
        }
      >
        Pick the providers, MCP servers, secrets, and apps this agent can use.
        Credentials are injected at request time, so the agent never sees the
        raw secret values.
      </HoverTooltip>
    </span>
  );
}

export function ConnectionsPicker({
  loading,
  secrets,
  apps,
  oauthApps = [],
  selSecrets,
  selApps,
  onToggleSecret,
  onToggleApp,
  onGoToProviders,
}: {
  loading: boolean;
  secrets: SecretView[];
  apps: AppConnectionView[];
  /** New api-server-driven OAuth apps. Granted via the underlying mirror
   *  secret's id, so they reuse `selSecrets` / `onToggleSecret`. */
  oauthApps?: OAuthAppEntry[];
  selSecrets: Set<string>;
  selApps: Set<string>;
  onToggleSecret: (id: string) => void;
  onToggleApp: (id: string) => void;
  onGoToProviders?: () => void;
}) {
  const providerSecrets = secrets.filter((s) => isProviderPresetType(s.type));
  const mcpSecrets = secrets.filter((s) => isMcpSecret(s));
  // Generic secrets exclude provider presets (Anthropic, IBM LiteLLM — they
  const genericSecrets = secrets.filter(
    (s) => s.type === "generic" && !isMcpSecret(s),
  );

  // Assigned app-ids that are no longer in the live `apps` list. Can happen
  // when a connection was revoked outside the UI; rendering them here keeps
  // "uncheck to unassign" as the recovery path.
  const knownAppIds = new Set(apps.map((a) => a.id));
  const staleAppIds = [...selApps].filter((id) => !knownAppIds.has(id));

  return (
    <div className="flex flex-col gap-3">
      <ConnectionsHeader />

      {loading && (
        <span className="text-[12px] text-text-muted">Loading...</span>
      )}
      {!loading &&
        secrets.length === 0 &&
        apps.length === 0 &&
        staleAppIds.length === 0 && (
          <span className="text-[12px] text-text-muted">
            No connections yet.
            {onGoToProviders && (
              <>
                {" "}
                <button
                  className="text-accent font-semibold hover:underline"
                  onClick={onGoToProviders}
                >
                  Add one
                </button>
              </>
            )}
          </span>
        )}

      <div className="flex flex-col gap-4">
        {providerSecrets.length > 0 && (
          <Section title="Provider">
            {providerSecrets.map((s) => (
              <ItemRow
                key={s.id}
                checked={selSecrets.has(s.id)}
                onToggle={() => onToggleSecret(s.id)}
                icon={<Sparkles size={14} className="text-warning" />}
                label={s.name}
              />
            ))}
            {providerSecrets.filter((s) => selSecrets.has(s.id)).length > 1 && (
              <div className="text-[11px] text-warning font-medium px-1 pt-1">
                Granting more than one Anthropic-family provider to a single
                agent produces undefined behavior — only one set of{" "}
                <code className="font-mono">ANTHROPIC_*</code> env vars actually
                wins at runtime.
              </div>
            )}
          </Section>
        )}

        {mcpSecrets.length > 0 && (
          <Section title="MCP Servers">
            {mcpSecrets.map((s) => (
              <ItemRow
                key={s.id}
                checked={selSecrets.has(s.id)}
                onToggle={() => onToggleSecret(s.id)}
                icon={<Globe size={14} className="text-info" />}
                label={mcpHostnameFromSecretName(s.name)}
              />
            ))}
          </Section>
        )}

        {genericSecrets.length > 0 && (
          <Section title="Secrets">
            {genericSecrets.map((s) => (
              <SecretItemRow
                key={s.id}
                secret={s}
                checked={selSecrets.has(s.id)}
                onToggle={() => onToggleSecret(s.id)}
              />
            ))}
          </Section>
        )}

        {(apps.length > 0 ||
          staleAppIds.length > 0 ||
          oauthApps.length > 0) && (
          <Section title="Apps">
            {oauthApps.map((entry) => (
              <OAuthAppItemRow
                key={entry.secretId}
                entry={entry}
                checked={selSecrets.has(entry.secretId)}
                onToggle={() => onToggleSecret(entry.secretId)}
              />
            ))}
            {apps.map((a) => (
              <AppItemRow
                key={a.id}
                label={a.name}
                identity={undefined}
                status={a.status}
                envNames={a.contributions
                  .filter(
                    (c): c is Extract<typeof c, { kind: "env" }> =>
                      c.kind === "env",
                  )
                  .map((c) => c.name)}
                checked={selApps.has(a.id)}
                onToggle={() => onToggleApp(a.id)}
              />
            ))}
            {staleAppIds.map((id) => (
              <AppItemRow
                key={id}
                label="Unavailable app"
                identity={id}
                status={undefined}
                envNames={[]}
                checked={selApps.has(id)}
                onToggle={() => onToggleApp(id)}
              />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">
        {title}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function ItemRow({
  checked,
  onToggle,
  icon,
  label,
  trailing,
}: {
  checked: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <label
      className={`flex items-center gap-3 rounded-lg border-2 bg-bg px-4 py-3 cursor-pointer transition-colors hover:border-accent ${
        checked ? "border-accent bg-accent-light" : "border-border-light"
      }`}
    >
      <input
        type="checkbox"
        className="accent-[var(--color-accent)] w-4 h-4"
        checked={checked}
        onChange={onToggle}
      />
      {icon}
      <span className="text-[13px] font-medium text-text flex-1">{label}</span>
      {trailing}
    </label>
  );
}

function SecretItemRow({
  secret,
  checked,
  onToggle,
}: {
  secret: SecretView;
  checked: boolean;
  onToggle: () => void;
}) {
  const headerName = secret.injectionConfig?.headerName;
  const customHeader =
    headerName && headerName.toLowerCase() !== "authorization"
      ? headerName
      : null;
  const envNames = secret.envMappings?.map((m) => m.envName) ?? [];
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border-2 bg-bg px-4 py-3 cursor-pointer transition-colors hover:border-accent ${
        checked ? "border-accent bg-accent-light" : "border-border-light"
      }`}
    >
      <input
        type="checkbox"
        className="accent-[var(--color-accent)] w-4 h-4 mt-0.5"
        checked={checked}
        onChange={onToggle}
      />
      <Lock size={14} className="text-text-secondary shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text truncate">
          {secret.name}
        </div>
        <div className="text-[11px] font-mono text-text-muted truncate">
          {secret.hostPattern}
          {secret.pathPattern && (
            <span className="text-text-secondary">{secret.pathPattern}</span>
          )}
        </div>
        {customHeader && (
          <div className="text-[11px] text-text-secondary truncate">
            <span className="text-text-muted uppercase tracking-[0.05em] font-bold mr-1.5">
              header
            </span>
            <span className="font-mono">{customHeader}</span>
          </div>
        )}
        {envNames.length > 0 && (
          <div className="text-[11px] text-accent truncate">
            <span className="text-text-muted uppercase tracking-[0.05em] font-bold mr-1.5">
              env
            </span>
            <span className="font-mono">{envNames.join(", ")}</span>
          </div>
        )}
      </div>
    </label>
  );
}

function OAuthAppItemRow({
  entry,
  checked,
  onToggle,
}: {
  entry: OAuthAppEntry;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border-2 bg-bg px-4 py-3 cursor-pointer transition-colors hover:border-accent ${
        checked ? "border-accent bg-accent-light" : "border-border-light"
      }`}
    >
      <input
        type="checkbox"
        className="accent-[var(--color-accent)] w-4 h-4 mt-0.5"
        checked={checked}
        onChange={onToggle}
      />
      <KeyRound size={14} className="text-text-secondary shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text truncate">
          {entry.displayName}
        </div>
        <div className="text-[11px] font-mono text-text-muted truncate">
          {entry.hosts.join(", ")}
        </div>
      </div>
      {entry.expired && (
        <span className="text-[11px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 shrink-0 bg-danger-light text-danger border-danger">
          Expired
        </span>
      )}
    </label>
  );
}

function AppItemRow({
  label,
  identity,
  status,
  envNames,
  checked,
  onToggle,
}: {
  label: string;
  identity?: string;
  status: AppConnectionView["status"] | undefined;
  envNames: string[];
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border-2 bg-bg px-4 py-3 cursor-pointer transition-colors hover:border-accent ${
        checked ? "border-accent bg-accent-light" : "border-border-light"
      }`}
    >
      <input
        type="checkbox"
        className="accent-[var(--color-accent)] w-4 h-4 mt-0.5"
        checked={checked}
        onChange={onToggle}
      />
      <KeyRound size={14} className="text-text-secondary shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text truncate">
          {label}
        </div>
        {identity && (
          <div className="text-[11px] font-mono text-text-muted truncate">
            {identity}
          </div>
        )}
        {envNames.length > 0 && (
          <div className="text-[11px] text-accent truncate">
            <span className="text-text-muted uppercase tracking-[0.05em] font-bold mr-1.5">
              env
            </span>
            <span className="font-mono">{envNames.join(", ")}</span>
          </div>
        )}
      </div>
      <AppStatusPill status={status} />
    </label>
  );
}
