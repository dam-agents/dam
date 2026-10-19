import { ArrowLeft } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { PAGE_TITLE } from "@/components/ui/page-header";
import { getErrorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { Markdown } from "../../../components/markdown.js";
import { takeReturnPath } from "../../../lib/return-path.js";
import { useStore } from "../../../store.js";
import { useAcceptTerms } from "../api/mutations.js";
import { useLatestAcceptance, useTermsDocument } from "../api/queries.js";

type LatestAcceptance = NonNullable<
  ReturnType<typeof useLatestAcceptance>["data"]
>;

export function TermsView() {
  const document = useTermsDocument();
  const latest = useLatestAcceptance();
  const accept = useAcceptTerms();

  if (document.isLoading || latest.isLoading) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }
  if (document.error || !document.data) {
    return (
      <CenteredMessage tone="error">
        Couldn't load the Terms of Use.
      </CenteredMessage>
    );
  }

  const doc = document.data;
  const acceptedCurrent = latest.data?.version === doc.version;
  const isStaleReaccept = !!latest.data && latest.data.version !== doc.version;

  return (
    <div className="mx-auto w-full max-w-200 px-4 py-10">
      {acceptedCurrent && <BackButton />}
      <h1 className={cn(PAGE_TITLE, "mb-2")}>Terms of Use</h1>
      {isStaleReaccept && (
        <p className="text-sm text-muted-foreground mb-4">
          The Terms of Use have been updated — please review and accept to
          continue.
        </p>
      )}
      <TermsMeta version={doc.version} accepted={latest.data} />
      <Markdown>{doc.text}</Markdown>
      {!acceptedCurrent && (
        <div className="mt-8 flex gap-3 items-center">
          <AcceptButton
            pending={accept.isPending}
            onClick={() =>
              accept.mutate(
                { version: doc.version },
                {
                  onSuccess: () =>
                    window.location.assign(takeReturnPath("terms")),
                },
              )
            }
          />
        </div>
      )}
      {accept.error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {acceptErrorText(accept.error)}
        </p>
      )}
    </div>
  );
}

function acceptErrorText(error: unknown): string {
  const message = getErrorMessage(error, "Couldn't accept the Terms of Use.");
  return message === "terms_stale"
    ? "The Terms of Use changed while you were reading. Reload the page to review the current version."
    : message;
}

function TermsMeta({
  version,
  accepted,
}: {
  version: string;
  accepted: LatestAcceptance | null | undefined;
}) {
  const isCurrent = accepted?.version === version;
  return (
    <div className="text-sm text-muted-foreground mb-6">
      Version <code>{version}</code>
      {isCurrent && accepted && (
        <>
          {" · "}Accepted on{" "}
          {formatDate(accepted.acceptedAt, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </>
      )}
    </div>
  );
}

function AcceptButton({
  pending,
  onClick,
}: {
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" disabled={pending} onClick={onClick}>
      {pending ? "Accepting…" : "I accept the Terms of Use"}
    </Button>
  );
}

function BackButton() {
  const navigateBack = useStore((s) => s.navigateBack);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={navigateBack}
      className="-ml-3 mb-4"
    >
      <ArrowLeft size={16} /> Back
    </Button>
  );
}

function CenteredMessage({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <div className="mx-auto w-full max-w-200 px-4 py-10">
      <div
        className={tone === "error" ? "text-danger" : "text-muted-foreground"}
      >
        {children}
      </div>
    </div>
  );
}
