import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
}

export function SetupPageShell({ title, subtitle, footer, children }: Props) {
  return (
    <div>
      <header className="mb-8">
        <h1 className="text-[22px] font-semibold tracking-[-0.4px] text-foreground">
          {title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </header>

      {children}

      <div className="flex items-center justify-end gap-3">{footer}</div>
    </div>
  );
}
