import {
  CloudApp,
  Launch,
  Locked,
  OverflowMenuVertical,
  Share,
  TrashCan,
} from "@carbon/icons-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { emitToast } from "@/lib/toast";

import { useDevToolsState } from "../../../../mock/dev-tools-state.js";
import { useStore } from "../../../../store.js";
import type { EnvironmentStatus, WorkEnvironment } from "../../../../types.js";
import { ShareEnvironmentDialog } from "./share-environment-dialog.js";
import { WorkCardShell } from "./work-card-shell.js";

function expiryLabel(
  expiresAt: string | undefined,
  status: EnvironmentStatus,
): string | undefined {
  if (status === "deleted") return undefined;
  if (status === "expired") return "Expired";
  if (!expiresAt) return undefined;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.ceil(ms / 86_400_000);
  if (days === 1) return "Expires in 1 day";
  return `Expires in ${days} days`;
}

function VisibilityLabel({ accessLabel }: { accessLabel?: string }) {
  const label = accessLabel?.toLowerCase();
  if (!label || label === "private" || label === "only you") {
    return (
      <>
        <Locked size={12} />
        Private
      </>
    );
  }
  return (
    <>
      <Share size={12} />
      {accessLabel}
    </>
  );
}

function CardDetail({
  label,
  accessLabel,
  expiry,
}: {
  label: string;
  accessLabel?: string;
  expiry?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <span className="mx-0.5">·</span>
      <VisibilityLabel accessLabel={accessLabel} />
      {expiry && (
        <>
          <span className="mx-0.5">·</span>
          {expiry}
        </>
      )}
    </span>
  );
}

function EnvironmentTrailingIcon({
  name,
  accessLabel,
}: {
  name: string;
  accessLabel?: string;
}) {
  const showConfirm = useStore.getState().showConfirm;
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="relative shrink-0"
            aria-label="Environment actions"
          >
            <Launch
              size={16}
              className={`transition-opacity ${menuOpen ? "opacity-0" : "group-hover/card:opacity-0"}`}
            />
            <OverflowMenuVertical
              size={16}
              className={`absolute inset-0 transition-opacity ${menuOpen ? "opacity-100" : "opacity-0 group-hover/card:opacity-100"}`}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => setTimeout(() => setShareOpen(true), 0)}
          >
            <Share size={13} /> Share
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              emitToast({
                kind: "success",
                message: `Extended ${name} by 1 day`,
              })
            }
          >
            Extend 1 day
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              emitToast({
                kind: "success",
                message: `Extended ${name} by 7 days`,
              })
            }
          >
            Extend 7 days
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              emitToast({
                kind: "success",
                message: `Extended ${name} by 30 days`,
              })
            }
          >
            Extend 30 days
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            tone="danger"
            onSelect={async () => {
              const ok = await showConfirm(
                "This will permanently delete the environment.",
                "Delete environment",
                { kind: "destructive" },
              );
              if (ok) {
                emitToast({
                  kind: "success",
                  message: `Deleted ${name}`,
                });
              }
            }}
          >
            <TrashCan size={13} /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {shareOpen && (
        <ShareEnvironmentDialog
          name={name}
          accessLabel={accessLabel}
          onClose={() => setShareOpen(false)}
        />
      )}
    </span>
  );
}

export function EnvironmentCard({ part }: { part: WorkEnvironment }) {
  const devOverride = useDevToolsState((s) => s.environmentStatus);
  const status: EnvironmentStatus =
    (import.meta.env.VITE_MOCK ? devOverride : null) ??
    part.status ??
    "running";

  const running = status === "running";
  const expired = status === "expired" || status === "deleted";
  const expiry = expiryLabel(part.expiresAt, status);
  const name = part.name ?? "Environment";

  return (
    <WorkCardShell
      icon={<CloudApp size={16} />}
      title={
        <>
          {name}
          <span
            className={`ml-1.5 inline-block size-2 shrink-0 translate-y-[-0.5px] rounded-full align-middle ${running ? "bg-[#24a148] dark:bg-[#42be65]" : "bg-[#697077]"}`}
          />
        </>
      }
      detail={
        <CardDetail
          label="Environment"
          accessLabel={part.accessLabel}
          expiry={expiry}
        />
      }
      trailingIcon={
        expired ? (
          <Launch size={16} />
        ) : (
          <EnvironmentTrailingIcon name={name} accessLabel={part.accessLabel} />
        )
      }
      disabled={expired}
      onClick={() => {
        if (part.url) {
          window.open(part.url, "_blank", "noopener");
        }
      }}
    />
  );
}
