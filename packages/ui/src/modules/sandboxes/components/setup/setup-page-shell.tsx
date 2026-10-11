import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui/page-header";

interface Props {
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
}

export function SetupPageShell({ title, subtitle, footer, children }: Props) {
  return (
    <div>
      <PageHeader title={title} description={subtitle} />

      {children}

      <div className="flex items-center justify-end gap-3">{footer}</div>
    </div>
  );
}
