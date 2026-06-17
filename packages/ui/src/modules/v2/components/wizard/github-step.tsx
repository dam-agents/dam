import { Check, Loader2 } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { api } from "../../../../api.js";
import { githubAppInstallUrl } from "../../../connections/lib/github-app-install-url.js";
import {
  type GithubMode,
  useGithubConnect,
} from "../../hooks/use-github-connect.js";
import { useOAuthPopup } from "../../hooks/use-oauth-popup.js";
import {
  saveSnapshot,
  type WizardSnapshot,
} from "../../lib/wizard-snapshot.js";
import { LabeledInput } from "../labeled-input.js";

type Target = "github" | "ghe";

const MODE: Record<Target, GithubMode> = {
  github: "github",
  ghe: "github-enterprise",
};

export function GithubStep({
  snapshot,
  update,
  onBack,
  onCreate,
  creating,
}: {
  snapshot: WizardSnapshot;
  update: (patch: Partial<WizardSnapshot>) => void;
  onBack: () => void;
  onCreate: () => void;
  creating: boolean;
}) {
  const { isBringYourOwnApp, ghePresetHost, findExisting, ensureConnectionId } =
    useGithubConnect();
  const [gheHost, setGheHost] = useState(snapshot.gheHost);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [authorizingTarget, setAuthorizingTarget] = useState<Target | null>(
    null,
  );
  const pendingTargetRef = useRef<Target | null>(null);

  const installUrlFor = (mode: GithubMode, host: string): string | null => {
    const existing = findExisting(mode, host);
    return existing ? githubAppInstallUrl(existing) : null;
  };

  const { open: openPopup, close: closePopup } = useOAuthPopup((result) => {
    const target = pendingTargetRef.current;
    pendingTargetRef.current = null;
    setAuthorizingTarget(null);
    if (result.ok && target) {
      setError(null);
      update(
        target === "github"
          ? { githubAuthorized: true }
          : { gheAuthorized: true },
      );
    } else if (result.message) {
      setError(result.message);
    }
  });

  const markConnection = (
    target: Target,
    id: string,
    host: string,
    authorized: boolean,
  ) =>
    update(
      target === "github"
        ? { githubConnectionId: id, githubAuthorized: authorized }
        : { gheConnectionId: id, gheHost: host, gheAuthorized: authorized },
    );

  const connect = async (target: Target) => {
    const mode = MODE[target];
    const host = target === "ghe" ? (ghePresetHost ?? gheHost.trim()) : "";
    if (target === "ghe" && !host)
      return setError("Enter the GitHub Enterprise host.");
    if (isBringYourOwnApp(mode) && (!clientId.trim() || !clientSecret.trim()))
      return setError("Enter the OAuth app client ID and secret.");
    setError(null);

    const existing = findExisting(mode, host);
    if (existing?.status === "active") {
      markConnection(target, existing.id, host, true);
      return;
    }

    const popup = openPopup();
    setAuthorizingTarget(target);
    pendingTargetRef.current = target;
    try {
      const { id } = await ensureConnectionId(mode, host, {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      markConnection(target, id, host, false);
      if (popup) {
        const { authUrl } = await api.connections.startOAuth.mutate({
          connectionId: id,
          popup: true,
        });
        popup.location.href = authUrl;
      } else {
        // Popup blocked: persist synchronously, then full-page redirect.
        saveSnapshot({
          ...snapshot,
          step: 2,
          ...(target === "github"
            ? { githubConnectionId: id, githubAuthorized: false }
            : {
                gheConnectionId: id,
                gheHost: host,
                gheAuthorized: false,
              }),
        });
        const { authUrl } = await api.connections.startOAuth.mutate({
          connectionId: id,
          returnTo: "/v2/new",
        });
        window.location.href = authUrl;
      }
    } catch (err) {
      closePopup();
      pendingTargetRef.current = null;
      setAuthorizingTarget(null);
      setError(
        err instanceof Error ? err.message : "Couldn't connect to GitHub.",
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[17px] font-bold text-foreground">
          Connect GitHub (optional)
        </h2>
        <p className="text-[13px] text-muted-foreground mt-1">
          Authorize GitHub so the sandbox can use git and the gh CLI. Connect
          either, both, or skip and add them later.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <ConnectionCard
          title="GitHub"
          description="Read + write repos, issues, and PRs on github.com."
          connected={snapshot.githubAuthorized && !!snapshot.githubConnectionId}
          installUrl={installUrlFor("github", "")}
          authorizing={authorizingTarget === "github"}
          disabled={authorizingTarget !== null}
          onAuthorize={() => connect("github")}
          onChange={() =>
            update({ githubConnectionId: null, githubAuthorized: false })
          }
        >
          {isBringYourOwnApp("github") && (
            <ByoFields
              clientId={clientId}
              clientSecret={clientSecret}
              setClientId={setClientId}
              setClientSecret={setClientSecret}
            />
          )}
        </ConnectionCard>

        <ConnectionCard
          title="GitHub Enterprise"
          description="Connect a self-hosted GitHub Enterprise host."
          connected={snapshot.gheAuthorized && !!snapshot.gheConnectionId}
          connectedLabel={`Connected to ${snapshot.gheHost}.`}
          installUrl={installUrlFor("github-enterprise", snapshot.gheHost)}
          authorizing={authorizingTarget === "ghe"}
          disabled={authorizingTarget !== null}
          onAuthorize={() => connect("ghe")}
          onChange={() =>
            update({ gheConnectionId: null, gheAuthorized: false })
          }
        >
          {ghePresetHost ? (
            <p className="text-[12px] text-muted-foreground">
              Host{" "}
              <span className="font-mono text-foreground">{ghePresetHost}</span>{" "}
              (configured by your operator).
            </p>
          ) : (
            <LabeledInput
              label="GitHub Enterprise host"
              placeholder="ghe.example.com"
              value={gheHost}
              onChange={setGheHost}
            />
          )}
          {isBringYourOwnApp("github-enterprise") && (
            <ByoFields
              clientId={clientId}
              clientSecret={clientSecret}
              setClientId={setClientId}
              setClientSecret={setClientSecret}
            />
          )}
        </ConnectionCard>
      </div>

      {error && (
        <p className="text-[12px] font-medium text-destructive">{error}</p>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={onBack} disabled={creating}>
          Back
        </Button>
        <Button onClick={onCreate} disabled={creating}>
          {creating && <Loader2 size={15} className="animate-spin" />}
          Create sandbox
        </Button>
      </div>
    </div>
  );
}

function ConnectionCard({
  title,
  description,
  connected,
  connectedLabel = "Connected to GitHub.",
  installUrl,
  authorizing,
  disabled,
  onAuthorize,
  onChange,
  children,
}: {
  title: string;
  description: string;
  connected: boolean;
  connectedLabel?: string;
  installUrl?: string | null;
  authorizing: boolean;
  disabled: boolean;
  onAuthorize: () => void;
  onChange: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="text-[14px] font-semibold text-foreground">{title}</div>
      <div className="text-[12px] text-muted-foreground">{description}</div>
      <div className="mt-3">
        {connected ? (
          <div className="flex items-center gap-2 text-[13px] text-success">
            <Check size={15} /> {connectedLabel}
            {installUrl && (
              <a
                href={installUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="ml-1 font-medium text-foreground hover:underline"
              >
                Install on GitHub
              </a>
            )}
            <button
              type="button"
              onClick={onChange}
              className="text-muted-foreground hover:text-foreground underline ml-1"
            >
              change
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {children}
            <Button
              variant="outline"
              onClick={onAuthorize}
              disabled={disabled}
              className="self-start"
            >
              {authorizing && <Loader2 size={15} className="animate-spin" />}
              {authorizing ? "Authorizing…" : "Authorize with GitHub"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ByoFields({
  clientId,
  clientSecret,
  setClientId,
  setClientSecret,
}: {
  clientId: string;
  clientSecret: string;
  setClientId: (v: string) => void;
  setClientSecret: (v: string) => void;
}) {
  return (
    <>
      <LabeledInput
        label="OAuth client ID"
        placeholder="Iv1.…"
        value={clientId}
        onChange={setClientId}
      />
      <LabeledInput
        label="OAuth client secret"
        type="password"
        value={clientSecret}
        onChange={setClientSecret}
      />
    </>
  );
}
