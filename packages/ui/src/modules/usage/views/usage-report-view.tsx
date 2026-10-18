import { ArrowLeft } from "@carbon/icons-react";
import {
  USAGE_REPORT_FRAME,
  usageReportFrameReadySchema,
} from "api-server-api";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { Spinner } from "@/components/ui/spinner";

import { getBrand } from "../../../brand.js";
import { useStore } from "../../../store.js";
import { routeToPath } from "../../platform/lib/routes.js";
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

  const access = useUsageInspectAvailability({ toast: false });
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
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const postTheme = () =>
      frame.current?.contentWindow?.postMessage(
        { type: USAGE_REPORT_FRAME.theme, value: theme },
        "*",
      );
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (!usageReportFrameReadySchema.safeParse(e.data).success) return;
      postTheme();
      setPainted(true);
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
    <>
      <iframe
        ref={frame}
        title="Usage analytics"
        srcDoc={report.data}
        sandbox="allow-scripts allow-downloads"
        referrerPolicy="no-referrer"
        className="fixed inset-0 h-full w-full border-0"
      />
      {!painted && (
        <div className="fixed inset-0">
          <Waiting>Building the report…</Waiting>
        </div>
      )}
      <Button
        asChild
        variant="outline"
        size="sm"
        className="fixed bottom-4 left-4 bg-background"
      >
        <a href={routeToPath({ view: "settings", settingsTab: "analytics" })}>
          <ArrowLeft size={14} />
          Back to settings
        </a>
      </Button>
    </>
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
