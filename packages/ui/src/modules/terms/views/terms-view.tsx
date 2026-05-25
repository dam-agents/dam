import type { TermsDocument } from "api-server-api";
import { useEffect, useState } from "react";

import { api } from "../../../api.js";
import { Markdown } from "../../../components/markdown.js";
import { useStore } from "../../../store.js";
import { fetchTermsDocument } from "../api/fetch-terms.js";

type LatestAcceptance = Awaited<
  ReturnType<typeof api.terms.latestAcceptance.query>
>;

export function TermsView() {
  const [doc, setDoc] = useState<TermsDocument | null>(null);
  const [latest, setLatest] = useState<LatestAcceptance>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const setView = useStore((s) => s.setView);
  const showToast = useStore((s) => s.showToast);

  useEffect(() => {
    void (async () => {
      try {
        const [d, l] = await Promise.all([
          fetchTermsDocument(),
          api.terms.latestAcceptance.query(),
        ]);
        setDoc(d);
        setLatest(l);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load terms");
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-[800px] px-4 py-10">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="mx-auto w-full max-w-[800px] px-4 py-10">
        <div className="text-muted">Loading…</div>
      </div>
    );
  }

  const acceptedCurrent = latest !== null && latest.version === doc.version;
  const blocking = !acceptedCurrent;

  async function onAccept() {
    if (!doc) return;
    setSubmitting(true);
    try {
      await api.terms.accept.mutate({ version: doc.version });
      const refreshed = await api.terms.latestAcceptance.query();
      setLatest(refreshed);
      showToast({ kind: "success", message: "Terms accepted." });
      setView("list");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to accept terms";
      if (message.toLowerCase().includes("terms_stale")) {
        const fresh = await fetchTermsDocument();
        setDoc(fresh);
        showToast({
          kind: "error",
          message: "Terms changed while you were reading. Please re-read.",
        });
      } else {
        showToast({ kind: "error", message });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[800px] px-4 py-10">
      <h1 className="text-2xl font-semibold mb-2">Terms of Use</h1>
      <div className="text-sm text-muted mb-6">
        Version <code>{doc.version}</code>
        {acceptedCurrent && latest && (
          <>
            {" · "}Accepted on{" "}
            {new Date(latest.acceptedAt).toLocaleDateString()}
          </>
        )}
      </div>
      <Markdown>{doc.text}</Markdown>
      <div className="mt-8 flex gap-3 items-center">
        {blocking ? (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void onAccept()}
            className="bg-accent text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {submitting ? "Accepting…" : "I accept the Terms of Use"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setView("list")}
            className="bg-accent text-white px-4 py-2 rounded"
          >
            Back
          </button>
        )}
      </div>
    </div>
  );
}
