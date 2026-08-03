import type { ReactNode } from "react";

import { StickyFooterLayout } from "./sticky-footer-layout.js";

interface Props {
  /** Left-hand navigation column (wizard stepper or section nav). */
  nav: ReactNode;
  /** Sticky footer content; omit to hide the footer bar entirely. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Shared page frame for the sandbox wizard and the sandbox home page: one
 * scroll region holding a sticky left nav beside a bounded content column, with
 * a full-width sticky footer. Keeps both pages in visual lockstep.
 */
export function SandboxTwoColumnShell({ nav, footer, children }: Props) {
  return (
    <StickyFooterLayout footer={footer} footerClassName="max-w-[920px]">
      <div className="mx-auto w-full max-w-[920px] px-4 pt-6 pb-8 md:px-8 md:pt-12">
        <div className="flex flex-col gap-6 md:flex-row md:gap-10">
          {nav}
          <div className="min-w-0 flex-1 md:max-w-[666px]">{children}</div>
        </div>
      </div>
    </StickyFooterLayout>
  );
}
