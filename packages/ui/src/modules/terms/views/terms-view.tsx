import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format-time";

import { Markdown } from "../../../components/markdown.js";
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
      <CenteredMessage tone="error">Failed to load Terms.</CenteredMessage>
    );
  }

  const doc = document.data;
  const acceptedCurrent = latest.data?.version === doc.version;
  const isStaleReaccept = !!latest.data && latest.data.version !== doc.version;

  return (
    <div className="mx-auto w-full max-w-200 px-4 py-10">
      <h1 className="text-2xl font-semibold mb-2">Terms of Use</h1>
      {isStaleReaccept && (
        <p className="text-sm text-muted-foreground mb-4">
          The Terms of Use have been updated — please review and accept to
          continue.
        </p>
      )}
      <TermsMeta version={doc.version} accepted={latest.data} />
      <Markdown>{doc.text}</Markdown>
      <div className="mt-8 flex gap-3 items-center">
        {acceptedCurrent ? (
          <BackButton />
        ) : (
          <AcceptButton
            pending={accept.isPending}
            onClick={() =>
              accept.mutate(
                { version: doc.version },
                // Full reload on purpose (unlike BackButton): it clears the
                // server's 412 terms_stale gate with a clean refetch.
                { onSuccess: () => window.location.assign("/") },
              )
            }
          />
        )}
      </div>
    </div>
  );
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
          {" · "}Accepted on {formatDate(accepted.acceptedAt)}
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
  const setView = useStore((s) => s.setView);
  // setView rather than history.back(): a deep link to /terms has no in-app
  // history behind it, and history.back() would leave the app entirely.
  return (
    <Button type="button" onClick={() => setView("list")}>
      Back
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
        className={tone === "error" ? "text-red-600" : "text-muted-foreground"}
      >
        {children}
      </div>
    </div>
  );
}
