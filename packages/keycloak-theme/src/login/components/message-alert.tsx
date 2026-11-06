import { kcSanitize } from "keycloakify/lib/kcSanitize";

import { cn } from "../../lib/cn.js";

export function MessageAlert({
  message,
  className,
}: {
  message: { type: string; summary: string };
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        message.type === "error"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: kcSanitize(message.summary) }}
    />
  );
}
