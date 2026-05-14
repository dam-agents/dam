import {
  Globe,
  Information as Info,
  Password as KeyRound,
  Password as Lock,
} from "@carbon/icons-react";
import type { AppConnectionView } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import { OAuthAppIcon } from "../modules/connections/components/oauth-app-icon.js";
import { AnthropicIcon } from "../modules/settings/components/brand-icons.js";
import type { SecretView } from "../types.js";
import {
  APP_OAUTH_SECRET_PREFIX,
  isMcpSecret,
  mcpHostnameFromSecretName,
} from "../types.js";
import { AppStatusPill } from "./app-status-pill.js";
import { HoverTooltip } from "./hover-tooltip.js";

/**
 * One row in the picker's "OAuth Apps" subsection. Joins the
 * api-server-managed app connection (host, displayName, expiry, appId for
 * the brand icon) with the K8s credential Secret's id (the grant target —
 * agents see the token via the Envoy sidecar's `Authorization: Bearer`
 * injection on `hostPattern`).
 */
export interface OAuthAppEntry {
  secretId: string;
  appId: string;
  displayName: string;
  hostPattern: string;
  expired: boolean;
}

export function ConnectionsHeader() {
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-bold text-foreground/80 uppercase tracking-[0.03em]">
      Connections
      <HoverTooltip
        trigger={
          <Info
            size={13}
            className="text-muted-foreground hover:text-foreground/80 cursor-help"
          />
        }
      >
        Pick the providers, MCP servers, secrets, and apps this agent can use. Credentials are injected at request time, so the agent never sees the raw secret values.
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
  const anthropicSecrets = secrets.filter((s) => s.type === "anthropic");
  const mcpSecrets = secrets.filter((s) => isMcpSecret(s));
  // Generic secrets exclude both platform-internal mirrors (MCP secrets and
  // app-OAuth token mirrors). Mirrors render under their own subsections so
  // they don't leak into the user-facing "Secrets" list.
  const genericSecrets = secrets.filter(
    (s) =>
      s.type !== "anthropic" &&
      !isMcpSecret(s) &&
      !s.name.startsWith(APP_OAUTH_SECRET_PREFIX),
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
        <span className="text-[12px] text-muted-foreground">Loading...</span>
      )}
      {!loading && secrets.length === 0 && apps.length === 0 && staleAppIds.length === 0 && (
        <span className="text-[12px] text-muted-foreground">
          No connections yet.
          {onGoToProviders && (
            <>
              {" "}
              <Button
                variant="link"
                className="h-auto p-0 text-[12px] font-semibold"
                onClick={onGoToProviders}
              >
                Add one
              </Button>
            </>
          )}
        </span>
      )}

      <div className="flex flex-col gap-4">
        {anthropicSecrets.length > 0 && (
          <Section title="Provider">
            {anthropicSecrets.map((s) => (
              <ItemRow
                key={s.id}
                checked={selSecrets.has(s.id)}
                onToggle={() => onToggleSecret(s.id)}
                icon={<AnthropicIcon className="w-3.5 h-3.5 text-[#D97757]" />}
                label={s.name}
                tone="muted"
              />
            ))}
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

        {(apps.length > 0 || staleAppIds.length > 0 || oauthApps.length > 0) && (
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
                label={a.label}
                identity={a.identity}
                status={a.status}
                envNames={a.envMappings?.map((m) => m.envName) ?? []}
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
      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.05em] mb-2">
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
  tone = "primary",
}: {
  checked: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  /** "primary" tints the selected row with the brand accent (the default
   *  for MCP/Apps), "muted" uses the neutral nav-style background. */
  tone?: "primary" | "muted";
}) {
  const checkedBg =
    tone === "muted" ? "border-border bg-muted" : "border-primary bg-primary/10";
  return (
    <label
      className={`flex items-center gap-3 rounded-lg border bg-background px-4 py-3 cursor-pointer transition-colors hover:border-primary ${
        checked ? checkedBg : "border-border"
      }`}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      {icon}
      <span className="text-[13px] font-medium text-foreground flex-1">{label}</span>
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
    headerName && headerName.toLowerCase() !== "authorization" ? headerName : null;
  const envNames = secret.envMappings?.map((m) => m.envName) ?? [];
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border bg-background px-4 py-3 cursor-pointer transition-colors hover:border-primary ${
        checked ? "border-primary bg-primary/10" : "border-border"
      }`}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5" />
      <Lock size={14} className="text-foreground/80 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-foreground truncate">
          {secret.name}
        </div>
        <div className="text-[11px] font-mono text-muted-foreground truncate">
          {secret.hostPattern}
          {secret.pathPattern && (
            <span className="text-foreground/80">{secret.pathPattern}</span>
          )}
        </div>
        {customHeader && (
          <div className="text-[11px] text-foreground/80 truncate">
            <span className="text-muted-foreground uppercase tracking-[0.05em] font-bold mr-1.5">
              header
            </span>
            <span className="font-mono">{customHeader}</span>
          </div>
        )}
        {envNames.length > 0 && (
          <div className="text-[11px] text-primary truncate">
            <span className="text-muted-foreground uppercase tracking-[0.05em] font-bold mr-1.5">
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
      className={`flex items-start gap-3 rounded-lg border bg-background px-4 py-3 cursor-pointer transition-colors hover:border-primary ${
        checked ? "border-primary bg-primary/10" : "border-border"
      }`}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5" />
      <span className="shrink-0 mt-0.5 text-foreground/80">
        <OAuthAppIcon appId={entry.appId} alt={entry.displayName} size={14} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-foreground truncate">{entry.displayName}</div>
        <div className="text-[11px] font-mono text-muted-foreground truncate">{entry.hostPattern}</div>
      </div>
      {entry.expired && (
        <Badge variant="destructive" className="shrink-0 uppercase tracking-[0.03em]">
          Expired
        </Badge>
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
      className={`flex items-start gap-3 rounded-lg border bg-background px-4 py-3 cursor-pointer transition-colors hover:border-primary ${
        checked ? "border-primary bg-primary/10" : "border-border"
      }`}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5" />
      <KeyRound size={14} className="text-foreground/80 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-foreground truncate">{label}</div>
        {identity && (
          <div className="text-[11px] font-mono text-muted-foreground truncate">
            {identity}
          </div>
        )}
        {envNames.length > 0 && (
          <div className="text-[11px] text-primary truncate">
            <span className="text-muted-foreground uppercase tracking-[0.05em] font-bold mr-1.5">
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
