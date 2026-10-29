import {
  Calendar,
  ChatBot,
  Edit,
  FolderMoveTo,
  Locked,
  OverflowMenuVertical,
  Share,
  TrashCan,
} from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
  expiresAt,
}: {
  name: string;
  accessLabel?: string;
  expiresAt?: string;
}) {
  const showConfirm = useStore.getState().showConfirm;
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <span
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex transition-opacity ${menuOpen ? "opacity-100" : "opacity-0 group-hover/card:opacity-100"}`}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Environment actions"
          >
            <OverflowMenuVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => {}}>
            <ChatBot size={13} /> Ask agent to edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => {}}>
            <Edit size={13} /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => {}}>
            <FolderMoveTo size={13} /> Move
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setTimeout(() => setShareOpen(true), 0)}
          >
            <Share size={13} /> Share
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => {}}>
            <Calendar size={13} /> Set expiration
          </DropdownMenuItem>
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
          expiresAt={expiresAt}
          onClose={() => setShareOpen(false)}
        />
      )}
    </span>
  );
}

export function EnvironmentCard({ part }: { part: WorkEnvironment }) {
  const devOverride = useDevToolsState((s) => s.environmentStatus);
  const setOpenEnvironment = useStore((s) => s.setOpenEnvironment);
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
      trailing={
        expired ? undefined : (
          <EnvironmentTrailingIcon
            name={name}
            accessLabel={part.accessLabel}
            expiresAt={part.expiresAt}
          />
        )
      }
      disabled={expired}
      onClick={() => {
        setOpenEnvironment({
          name,
          status,
          url: part.url,
          expiresAt: part.expiresAt,
          accessLabel: part.accessLabel,
          items: part.items ?? [],
        });
      }}
    />
  );
}
