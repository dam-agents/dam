import { Check, Copy, ExternalLink } from "lucide-react";
import { useRef, useState } from "react";

import { Modal } from "../../../components/modal.js";
import { useStore } from "../../../store.js";
import { discoverOAuthEndpoints, type OAuthAppDescriptor } from "../api/fetchers.js";
import { useStartAppOAuth } from "../api/mutations.js";

const INPUT_CLASS =
  "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

function discoveryHelperText(
  discovery: { state: "idle" | "loading" | "ok" | "miss"; source?: string },
  appName: string,
) {
  if (discovery.state === "loading") {
    return <span className="text-[12px] text-text-muted">Looking up issuer metadata…</span>;
  }
  if (discovery.state === "ok") {
    return (
      <span className="text-[12px] text-success">
        Auto-filled authorization and token endpoints from{" "}
        <code className="font-mono">{discovery.source}</code>.
      </span>
    );
  }
  if (discovery.state === "miss") {
    return (
      <span className="text-[12px] text-text-muted">
        No issuer metadata found — fill in the {appName} URLs manually below.
      </span>
    );
  }
  return null;
}

function CallbackUrlField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(url).catch(() => {
      // Browsers may reject without focus / on http; fall back is a no-op.
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-semibold text-text">Callback URL</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 h-10 rounded-lg border-2 border-border-light bg-bg px-4 flex items-center text-[13px] font-mono text-text-secondary truncate">
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          className="btn-brutal h-10 w-10 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent shadow-brutal-sm"
          title="Copy callback URL"
        >
          {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
        </button>
      </div>
      <span className="text-[12px] text-text-muted">
        Paste this exact URL into your OAuth app's Authorization callback / redirect URI field.
      </span>
    </div>
  );
}

interface Props {
  app: OAuthAppDescriptor;
  onCancel: () => void;
}

export function ConnectAppForm({ app, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  // Override toggle — when `credentialsInherited`, optional inputs (e.g.
  // clientId/clientSecret for a sibling Google connection) stay hidden
  // until the user explicitly opts in to provide alternates.
  const [showOverride, setShowOverride] = useState(false);
  // Discovery state — `host` carries the value we last discovered against,
  // so re-blurring on the same host doesn't refetch. `error` is shown
  // inline and is non-blocking.
  const [discovery, setDiscovery] = useState<{
    host: string | null;
    state: "idle" | "loading" | "ok" | "miss";
    source?: string;
  }>({ host: null, state: "idle" });
  const showToast = useStore((s) => s.showToast);
  const startAppOAuth = useStartAppOAuth();
  const lastDiscoveredHost = useRef<string | null>(null);

  // Inputs the user actually sees and must fill: required ones plus any
  // optional ones the override panel is showing.
  const visibleInputs = app.inputs.filter((f) => !f.optional || showOverride);
  const allFilled = app.inputs
    .filter((field) => !field.optional)
    .every((field) => (values[field.name] ?? "").trim().length > 0);

  const setField = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const runDiscovery = async (host: string) => {
    if (!host || host === lastDiscoveredHost.current) return;
    lastDiscoveredHost.current = host;
    setDiscovery({ host, state: "loading" });
    const result = await discoverOAuthEndpoints(host);
    if (!result) {
      setDiscovery({ host, state: "miss" });
      return;
    }
    setDiscovery({ host, state: "ok", source: result.source });
    // Only fill fields the user hasn't typed into — never overwrite.
    setValues((prev) => {
      const next = { ...prev };
      const targets: Array<[keyof typeof result, string]> = [
        ["authorizationUrl", "authorizationUrl"],
        ["tokenEndpoint", "tokenEndpoint"],
      ];
      for (const [key, fieldName] of targets) {
        const value = result[key];
        const fieldExists = app.inputs.some((f) => f.name === fieldName);
        if (
          fieldExists &&
          typeof value === "string" &&
          (next[fieldName] ?? "").trim() === ""
        ) {
          next[fieldName] = value;
        }
      }
      return next;
    });
  };

  const submit = () => {
    if (!allFilled) return;
    // Drop optional fields unless the override panel is open AND the user
    // typed something into them. Without the `showOverride` gate, values
    // typed into an override panel that the user later closed would
    // silently leak through to the backend; gating ties "submit override"
    // to "override is currently visible." Empty values fall through to
    // the backend's family-credential merge, which fills them from a
    // sibling connection.
    const input = Object.fromEntries(
      app.inputs
        .map((field) => [field.name, (values[field.name] ?? "").trim()] as const)
        .filter(([, v], i) => !app.inputs[i]!.optional || (showOverride && v.length > 0)),
    );
    startAppOAuth.mutate(
      { appId: app.id, input },
      {
        onSuccess: (data) => {
          if (data.error) {
            showToast({ kind: "error", message: data.error });
            return;
          }
          if (data.authUrl) {
            sessionStorage.setItem("platform-return-view", "connections");
            window.location.href = data.authUrl;
          }
        },
        onError: (err) => {
          showToast({ kind: "error", message: err.message });
        },
      },
    );
  };

  return (
    <Modal widthClass="w-[480px]">
      {/* Scrollable body — `min-h-0 flex-1` lets the modal cap at max-h-[85vh]
         and the inner area scroll when content overflows; the footer below
         stays pinned. */}
      <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-5 p-5 md:p-7">
        <h2 className="text-[20px] font-bold text-text">Connect {app.displayName}</h2>
        <p className="text-[13px] text-text-secondary">{app.description}</p>
        {app.registrationUrl && (
          <a
            href={app.registrationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-accent hover:underline inline-flex items-center gap-1.5"
          >
            Register an OAuth app first <ExternalLink size={13} />
          </a>
        )}
        <CallbackUrlField url={app.callbackUrl} />
        {app.credentialsInherited && (
          <div className="rounded-lg border-2 border-success/30 bg-success/5 px-4 py-3 text-[12px] text-text-secondary">
            <div>
              Reusing the Client ID and secret from another connected app in
              this family — no need to re-enter them.
            </div>
            <button
              type="button"
              className="mt-1.5 text-[12px] font-semibold text-accent hover:underline"
              onClick={() => setShowOverride((v) => !v)}
            >
              {showOverride ? "Use stored credentials instead" : "Use different credentials"}
            </button>
          </div>
        )}
        {visibleInputs.map((field) => {
          const isDiscoveryHostField = app.discoverFromHostField === field.name;
          const helperOverride =
            isDiscoveryHostField && discovery.host === (values[field.name] ?? "").trim()
              ? discoveryHelperText(discovery, app.displayName)
              : null;
          return (
            <div key={field.name} className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold text-text">{field.label}</label>
              <input
                type={field.secret ? "password" : "text"}
                className={INPUT_CLASS}
                value={values[field.name] ?? ""}
                onChange={(e) => setField(field.name, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && allFilled && submit()}
                onBlur={
                  isDiscoveryHostField
                    ? () => {
                        const v = (values[field.name] ?? "").trim();
                        if (v) void runDiscovery(v);
                      }
                    : undefined
                }
                placeholder={field.placeholder ?? ""}
                autoComplete="off"
                autoFocus={field === visibleInputs[0]}
              />
              {helperOverride ?? (field.helper && (
                <span className="text-[12px] text-text-muted">{field.helper}</span>
              ))}
            </div>
          );
        })}
      </div>
      {/* Footer is pinned outside the scroll region so Connect/Cancel are
         always reachable, even on short viewports / long descriptors. */}
      <div className="flex justify-end gap-3 p-5 md:p-7 border-t-2 border-border-light">
        <button
          type="button"
          className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text shadow-brutal-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40 shadow-brutal-accent"
          onClick={submit}
          disabled={!allFilled || startAppOAuth.isPending}
        >
          {startAppOAuth.isPending ? "..." : "Connect"}
        </button>
      </div>
    </Modal>
  );
}
