import type { ReactNode } from "react";

import { PAGE_TITLE } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { ConnectionIcon } from "../../../connections/components/connection-icon.js";

export type BindMessenger = "slack" | "telegram";

export const PICKER_WIDTH = "max-w-197";
const TEXT_WIDTH = "max-w-132";

interface Props {
  messenger: BindMessenger;
  title: string;
  subtitle?: ReactNode;
  narrow?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
}

export function BindPage({
  messenger,
  title,
  subtitle,
  narrow = false,
  children,
  footer,
}: Props) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 px-6 py-12">
        <div
          className={cn("mx-auto w-full", narrow ? TEXT_WIDTH : PICKER_WIDTH)}
        >
          <h1 className={cn("flex items-center gap-3", PAGE_TITLE)}>
            <ConnectionIcon iconSlug={messenger} alt="" size={32} />
            {title}
          </h1>
          {subtitle && (
            <p className="mt-6 text-sm text-muted-foreground">{subtitle}</p>
          )}
          {children}
        </div>
      </div>
      {footer}
    </div>
  );
}
