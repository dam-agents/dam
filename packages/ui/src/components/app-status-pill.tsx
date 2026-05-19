import type { AppConnectionView } from "api-server-api";

type Status = AppConnectionView["status"] | undefined;

function styleFor(status: Status): {
  pillClass: string;
  dotClass: string;
  label: string;
} {
  switch (status) {
    case "connected":
      return {
        pillClass: "bg-success-light text-success border-success",
        dotClass: "bg-success",
        label: "Connected",
      };
    case "expired":
      return {
        pillClass: "bg-danger-light text-danger border-danger",
        dotClass: "bg-danger",
        label: "Expired",
      };
    case "disconnected":
      return {
        pillClass: "bg-surface-raised text-text-muted border-border-light",
        dotClass: "bg-text-muted",
        label: "Disconnected",
      };
    case "unknown":
      return {
        pillClass: "bg-surface-raised text-text-muted border-border-light",
        dotClass: "bg-text-muted",
        label: "Unknown",
      };
    default:
      return {
        pillClass: "bg-surface-raised text-text-muted border-border-light",
        dotClass: "bg-text-muted",
        label: "Unresolved",
      };
  }
}

export function AppStatusPill({
  status,
  size = "sm",
}: {
  status: Status;
  size?: "sm" | "md";
}) {
  const { pillClass, dotClass, label } = styleFor(status);
  const textSize = size === "md" ? "text-[11px]" : "text-[10px]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${textSize} font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 shrink-0 ${pillClass}`}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotClass}`}
      />
      {label}
    </span>
  );
}
