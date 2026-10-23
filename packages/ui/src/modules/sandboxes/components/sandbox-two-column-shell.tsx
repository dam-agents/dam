import type { ReactNode } from "react";

import { StickyFooterLayout } from "./sticky-footer-layout.js";

interface Props {
  nav: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function SandboxTwoColumnShell({ nav, footer, children }: Props) {
  return (
    <StickyFooterLayout footer={footer} footerClassName="max-w-[1040px]">
      <div className="mx-auto w-full max-w-[1040px] px-4 pt-6 pb-8 md:px-8 md:pt-12">
        <div className="flex flex-col gap-6 md:flex-row md:gap-10">
          {nav}
          {}
          <div className="min-w-0 flex-1 md:max-w-[760px]">{children}</div>
        </div>
      </div>
    </StickyFooterLayout>
  );
}
