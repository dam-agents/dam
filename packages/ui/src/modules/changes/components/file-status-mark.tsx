import { cn } from "@/lib/utils";

import type { FileChangeStatus } from "../types.js";

const STATUS_CONFIG: Record<
  FileChangeStatus,
  { letter: string; className: string }
> = {
  added: { letter: "A", className: "text-[#24a148] dark:text-[#42be65]" },
  deleted: { letter: "D", className: "text-[#dc2626] dark:text-[#fa4d56]" },
  modified: { letter: "M", className: "text-[#f1c21b] dark:text-[#f1c21b]" },
  renamed: { letter: "R", className: "text-[#4589ff] dark:text-[#78a9ff]" },
};

export function FileStatusMark({
  status,
  uncommitted,
}: {
  status: FileChangeStatus;
  uncommitted?: boolean;
}) {
  const config = STATUS_CONFIG[status];
  return (
    <span className="relative inline-flex items-center justify-center">
      <span
        className={cn(
          "inline-flex size-4 items-center justify-center text-[10px] font-bold",
          config.className,
        )}
      >
        {config.letter}
      </span>
      {uncommitted && (
        <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-[#f1c21b]" />
      )}
    </span>
  );
}
