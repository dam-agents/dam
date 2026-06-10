import { Button } from "@/components/ui/button";

import { Markdown } from "../../../components/markdown.js";
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

  return (
    <div className="mx-auto w-full max-w-200 px-4 py-10">
      <h1 className="text-2xl font-semibold mb-2">Terms of Use</h1>
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
    <div className="text-sm text-muted mb-6">
      Version <code>{version}</code>
      {isCurrent && accepted && (
        <>
          {" · "}Accepted on{" "}
          {new Date(accepted.acceptedAt).toLocaleDateString()}
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
  return (
    <Button type="button" onClick={() => window.location.assign("/")}>
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
      <div className={tone === "error" ? "text-red-600" : "text-muted"}>
        {children}
      </div>
    </div>
  );
}
