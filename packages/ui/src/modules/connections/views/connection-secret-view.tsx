import { CheckmarkFilled, WarningAlt } from "@carbon/icons-react";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import {
  type CredentialCheck,
  credentialExpiresSoon,
  type SecretRequestView,
} from "api-server-api";
import { type FormEvent, type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PAGE_TITLE } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { getBrand } from "../../../brand.js";
import { trpc } from "../../../trpc.js";
import { ConnectionIcon } from "../components/connection-icon.js";
import { LabeledInput } from "../forms/labeled-input.js";
import {
  credentialCheckDetails,
  destinationDetail,
  destinationLabel,
  heldCheckCopy,
  readSecretRequestId,
  secretRequestErrorCopy,
} from "../lib/secret-request.js";

const requestId = readSecretRequestId(window.location.search);

function errorCode(e: unknown): string | undefined {
  return (e as { data?: { code?: string } } | null)?.data?.code;
}

export function ConnectionSecretView() {
  const request = useQuery({
    ...trpc.connections.getSecretRequest.queryOptions(
      requestId ? { requestId } : skipToken,
    ),
    staleTime: Infinity,
    retry: false,
  });
  const [done, setDone] = useState<Outcome | null>(null);

  if (!requestId) {
    return (
      <Terminal title="This page is opened from the command line">
        Run <code>dam connection connect</code> or{" "}
        <code>dam connection update</code> without the secret to get a link.
      </Terminal>
    );
  }
  if (done?.kind === "saved") {
    return <SavedPage check={done.check} granted={done.granted} />;
  }
  if (done?.kind === "cancelled") {
    return (
      <Terminal title="Cancelled">
        Nothing was saved. You can close this page.
      </Terminal>
    );
  }
  if (request.isPending) return <Page title="Enter a secret" />;
  if (request.isError || !request.data) {
    const copy = secretRequestErrorCopy(
      request.isError ? errorCode(request.error) : "NOT_FOUND",
    );
    return <Terminal title={copy.title}>{copy.hint}</Terminal>;
  }
  return (
    <SecretForm requestId={requestId} view={request.data} onDone={setDone} />
  );
}

type Outcome =
  | { kind: "saved"; check?: CredentialCheck; granted?: boolean }
  | { kind: "cancelled" };

function GrantFailed({ granted }: { granted?: boolean }) {
  if (granted !== false) return null;
  return (
    <span
      className="mb-3 block text-warning-fg"
      data-testid="secret-request-not-granted"
    >
      The agent that asked for it did not get it. Grant the connection in the
      agent's Connections section.
    </span>
  );
}

function SavedPage({
  check,
  granted,
}: {
  check?: CredentialCheck;
  granted?: boolean;
}) {
  if (check && check.status !== "passed") {
    return (
      <Terminal
        title="Secret saved without a passing check"
        icon={<WarningAlt size={24} className="text-warning-fg" />}
      >
        <GrantFailed granted={granted} />
        {check.reason ? `${check.reason}. ` : ""}The command that opened this
        page reports it too. Replace the secret once you have a working one.
      </Terminal>
    );
  }
  const details = check ? credentialCheckDetails(check) : [];
  const expiresSoon = check ? credentialExpiresSoon(check) : false;
  return (
    <Terminal
      title={
        expiresSoon
          ? "Secret checked and saved; it expires within a day"
          : check
            ? "Secret checked and saved"
            : "Secret saved"
      }
      icon={
        expiresSoon ? (
          <WarningAlt size={24} className="text-warning-fg" />
        ) : (
          <CheckmarkFilled size={24} className="text-success" />
        )
      }
    >
      {details.length > 0 && (
        <span className="mb-3 block" data-testid="secret-request-check">
          {details.map((d) => (
            <span key={d} className="block font-mono text-foreground">
              {d}
            </span>
          ))}
        </span>
      )}
      <GrantFailed granted={granted} />
      You can close this page. The command that opened it reports the result.
    </Terminal>
  );
}

function SecretForm({
  requestId,
  view,
  onDone,
}: {
  requestId: string;
  view: SecretRequestView;
  onDone: (outcome: Outcome) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [held, setHeld] = useState<CredentialCheck | null>(null);
  const submit = useMutation(
    trpc.connections.submitSecretRequest.mutationOptions(),
  );
  const cancel = useMutation(
    trpc.connections.cancelSecretRequest.mutationOptions(),
  );
  const complete = view.fields.every(
    (f) => (values[f.name] ?? "").trim().length > 0,
  );
  const pending = submit.isPending || cancel.isPending;

  const save = (saveAnyway: boolean) =>
    submit.mutate(
      { requestId, fields: values, ...(saveAnyway ? { saveAnyway } : {}) },
      {
        onSuccess: (result) => {
          if (result.status === "check-not-passed") {
            setHeld(result.check);
            return;
          }
          onDone({
            kind: "saved",
            ...(result.check ? { check: result.check } : {}),
            ...(result.granted !== undefined
              ? { granted: result.granted }
              : {}),
          });
        },
      },
    );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!complete || pending) return;
    save(false);
  };

  return (
    <Page
      title={
        view.action === "create"
          ? `Connect ${view.templateName}`
          : `Replace the secret of ${view.connectionName}`
      }
      iconSlug={view.iconSlug}
    >
      <p className="mt-4 text-sm text-muted-foreground">
        {view.requestedBy
          ? `Your agent ${view.requestedBy.name} asks for this secret.`
          : "A command you ran asks for this secret."}{" "}
        Enter it here, not in a chat: {getBrand().name} stores it, and your
        agents never see it.
      </p>
      <Summary view={view} />
      {view.customDestination && view.unexpectedHosts.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          This connection type sends the secret to any host the command names.
          Check that the hosts above belong to the service the secret is for.
        </p>
      )}
      {view.unexpectedHosts.length > 0 && (
        <Callout
          tone="warning"
          role="alert"
          className="mt-6 flex gap-2.5 text-sm"
        >
          <WarningAlt size={16} className="mt-0.5 shrink-0 text-warning-fg" />
          <p>
            <span className="font-semibold text-warning-fg">
              This secret will be sent to{" "}
              {view.unexpectedHosts.length === 1 ? "a host" : "hosts"} that{" "}
              {view.templateName} does not use:{" "}
              {view.unexpectedHosts.join(", ")}.
            </span>{" "}
            Cancel unless you set this host yourself.
          </p>
        </Callout>
      )}
      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={onSubmit}
        autoComplete="off"
      >
        {view.fields.map((field, i) => (
          <LabeledInput
            key={field.name}
            label={field.label}
            testId={`secret-request-${field.name}`}
            type="password"
            multiline={field.multiline}
            placeholder={
              field.multiline ? "-----BEGIN RSA PRIVATE KEY-----\n…" : "•••••"
            }
            value={values[field.name] ?? ""}
            onChange={(v) => {
              setHeld(null);
              setValues((prev) => ({ ...prev, [field.name]: v }));
            }}
            error={i === 0 ? submit.error?.message : undefined}
            autoFocus={i === 0}
            disabled={pending}
          />
        ))}
        {held && <HeldCheck check={held} />}
        <div className="flex gap-3">
          <Button type="submit" disabled={!complete || pending}>
            {submit.isPending && !held ? "Checking…" : "Save secret"}
          </Button>
          {held && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => save(true)}
              data-testid="secret-request-save-anyway"
            >
              Save anyway
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              cancel.mutate(
                { requestId },
                { onSuccess: () => onDone({ kind: "cancelled" }) },
              )
            }
          >
            Cancel
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          This link works once and expires at{" "}
          {new Date(view.expiresAt).toLocaleTimeString()}.
        </p>
      </form>
    </Page>
  );
}

function HeldCheck({ check }: { check: CredentialCheck }) {
  const copy = heldCheckCopy(check);
  return (
    <Callout
      tone="warning"
      role="alert"
      className="flex gap-2.5 text-sm"
      data-testid="secret-request-held"
    >
      <WarningAlt size={16} className="mt-0.5 shrink-0 text-warning-fg" />
      <div>
        <p className="font-semibold text-warning-fg">{copy.title}</p>
        {check.reason && <p className="mt-1">{check.reason}.</p>}
        {check.status === "passed" &&
          credentialCheckDetails(check).map((d) => (
            <p key={d} className="mt-1 font-mono text-foreground">
              {d}
            </p>
          ))}
        <p className="mt-1 text-muted-foreground">{copy.hint}</p>
      </div>
    </Callout>
  );
}

function Summary({ view }: { view: SecretRequestView }) {
  const rows: [string, ReactNode][] = [
    ["Connection", view.connectionName],
    ["Type", view.templateName],
    [
      view.destinations.length === 1 ? "Sent to" : "Sent to these hosts",
      <ul className="flex flex-col gap-1" key="destinations">
        {view.destinations.map((d) => (
          <li key={destinationLabel(d)}>
            <span
              className={cn(
                "font-mono font-semibold",
                view.unexpectedHosts.includes(d.host) && "text-warning-fg",
              )}
            >
              {destinationLabel(d)}
            </span>
            {destinationDetail(d) && (
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {destinationDetail(d)}
              </span>
            )}
          </li>
        ))}
      </ul>,
    ],
  ];
  if (view.tokenEndpoint) {
    rows.push([
      "Tokens from",
      "url" in view.tokenEndpoint ? (
        <span className="font-mono">{view.tokenEndpoint.url}</span>
      ) : (
        `the authorization server ${view.tokenEndpoint.discoveredFrom} names`
      ),
    ]);
  }
  if (view.envNames.length > 0) {
    rows.push([
      "Agents see",
      <span key="env">
        <span className="font-mono">{view.envNames.join(", ")}</span>, holding a
        placeholder, never the secret
      </span>,
    ]);
  }
  if (view.action === "update") {
    rows.push([
      "Used by",
      view.grantedAgents.length > 0
        ? view.grantedAgents.map((a) => a.name).join(", ")
        : "no agent yet",
    ]);
  } else {
    rows.push([
      "Used by",
      view.requestedBy
        ? `${view.requestedBy.name}, once you save`
        : "no agent until you grant it",
    ]);
  }
  return (
    <dl
      className="mt-6 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3 text-sm"
      data-testid="secret-request-summary"
    >
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Page({
  title,
  iconSlug,
  children,
}: {
  title: string;
  iconSlug?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col px-6 py-12">
      <div className="mx-auto w-full max-w-132">
        <h1 className={cn("flex items-center gap-3", PAGE_TITLE)}>
          <ConnectionIcon iconSlug={iconSlug ?? "key"} alt="" size={32} />
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}

function Terminal({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col px-6 py-12">
      <div className="mx-auto w-full max-w-132">
        <h1 className={cn("flex items-center gap-3", PAGE_TITLE)}>
          {icon}
          {title}
        </h1>
        <p className="mt-6 text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
