import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { getBrand } from "../../../brand.js";

export interface Breadcrumb {
  label: string;
  onClick?: () => void;
}

/**
 * Shell-less full-screen frame for the v2 surface: a thin breadcrumb header
 * over a flex content column. No sidebar or mobile nav — the v2 surface is
 * deliberately chrome-free.
 */
export function SandboxShell({
  breadcrumbs,
  children,
  contentClassName,
}: {
  breadcrumbs: Breadcrumb[];
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <div className="flex flex-col h-dvh bg-background">
      <header className="flex items-center gap-1.5 border-b border-border px-4 md:px-6 h-14 shrink-0 text-[14px]">
        <span className="font-bold text-foreground">{getBrand().name}</span>
        {breadcrumbs.map((crumb, i) => (
          <Crumb key={i} crumb={crumb} last={i === breadcrumbs.length - 1} />
        ))}
      </header>
      <main className={cn("flex flex-1 flex-col min-h-0", contentClassName)}>
        {children}
      </main>
    </div>
  );
}

function Crumb({ crumb, last }: { crumb: Breadcrumb; last: boolean }) {
  return (
    <>
      <ChevronRight size={14} className="text-muted-foreground shrink-0" />
      {crumb.onClick && !last ? (
        <button
          type="button"
          onClick={crumb.onClick}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {crumb.label}
        </button>
      ) : (
        <span className={last ? "text-foreground" : "text-muted-foreground"}>
          {crumb.label}
        </span>
      )}
    </>
  );
}
