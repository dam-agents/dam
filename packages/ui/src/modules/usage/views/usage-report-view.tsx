import { type ReactNode, useEffect, useRef } from "react";

import { PageEmptyState } from "@/components/ui/page-empty-state";
import { Spinner } from "@/components/ui/spinner";

import { getBrand } from "../../../brand.js";
import { useStore } from "../../../store.js";
import {
  useUsageInspectAvailability,
  useUsageReportHtml,
} from "../api/queries.js";
import { UsageNoAccessView } from "./usage-no-access-view.js";

export function UsageReportView() {
  useEffect(() => {
    const previous = document.title;
    document.title = `Usage analytics · ${getBrand().name}`;
    return () => {
      document.title = previous;
    };
  }, []);

  const access = useUsageInspectAvailability();
  if (access.isPending) return <Waiting>Checking your access…</Waiting>;
  if (access.isError) {
    return (
      <Standalone>
        <PageEmptyState
          title="Could not check your access"
          message={access.error.message}
          actionLabel="Try again"
          onAction={() => void access.refetch()}
        />
      </Standalone>
    );
  }
  if (!access.data) return <UsageNoAccessView />;
  return <UsageReportFrame />;
}

function UsageReportFrame() {
  const report = useUsageReportHtml();
  const theme = useStore((s) => s.theme);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const postTheme = () =>
      frame.current?.contentWindow?.postMessage(
        { type: "theme", value: theme },
        "*",
      );
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if ((e.data as { type?: unknown } | null)?.type === "ready") postTheme();
    };
    window.addEventListener("message", onMessage);
    postTheme();
    return () => window.removeEventListener("message", onMessage);
  }, [theme]);

  if (report.isPending) return <Waiting>Building the report…</Waiting>;
  if (report.isError) {
    return (
      <Standalone>
        <PageEmptyState
          title="The report could not be built"
          message={report.error.message}
          actionLabel="Try again"
          onAction={() => void report.refetch()}
        />
      </Standalone>
    );
  }
  return (
    <iframe
      ref={frame}
      title="Usage analytics"
      srcDoc={report.data}
      sandbox="allow-scripts allow-downloads"
      referrerPolicy="no-referrer"
      className="fixed inset-0 h-full w-full border-0"
    />
  );
}

function Standalone({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-200 px-4 py-10">{children}</div>;
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh items-center justify-center gap-3 bg-background text-sm text-foreground">
      <Spinner size={20} />
      {children}
    </div>
  );
}
