import {
  Calendar,
  ChatBot,
  CloudApp,
  Edit,
  Locked,
  Move,
  OverflowMenuVertical,
  Search,
  Share,
  TrashCan,
} from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { formatBytes } from "@/lib/format-size";
import { emitToast } from "@/lib/toast";

import {
  environmentsByAgent,
  type MockEnvironment,
} from "../../../mock/data/environments.js";
import { useStore } from "../../../store.js";
import type { EnvironmentStatus } from "../../../types.js";
import { ShareEnvironmentDialog } from "../../sessions/components/work-cards/share-environment-dialog.js";
import { useArtifacts } from "../api/queries.js";
import { ArtifactPreviewDialog } from "../components/artifact-preview-dialog.js";
import { ArtifactRow } from "../components/artifact-row.js";
import { MoveArtifactDialog } from "../components/move-artifact-dialog.js";
import { RenameArtifactDialog } from "../components/rename-artifact-dialog.js";
import { RetentionDialog } from "../components/retention-dialog.js";
import { ShareDialog } from "../components/share-dialog.js";
import { UploadArtifactDialog } from "../components/upload-artifact-dialog.js";

const EMPTY_ARTIFACTS: LibraryArtifact[] = [];

type ArtifactDialog =
  | { kind: "upload" }
  | { kind: "rename"; artifact: LibraryArtifact }
  | { kind: "move"; artifact: LibraryArtifact }
  | { kind: "share"; artifact: LibraryArtifact }
  | { kind: "retention"; artifact: LibraryArtifact }
  | { kind: "preview"; artifact: LibraryArtifact };

function envExpiryLabel(
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

function EnvironmentRow({ env }: { env: MockEnvironment }) {
  const setOpenEnvironment = useStore((s) => s.setOpenEnvironment);
  const showConfirm = useStore((s) => s.showConfirm);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const running = env.status === "running";
  const expired = env.status === "expired" || env.status === "deleted";
  const expiry = envExpiryLabel(env.expiresAt, env.status);
  const isPrivate =
    !env.accessLabel ||
    env.accessLabel.toLowerCase() === "private" ||
    env.accessLabel.toLowerCase() === "only you";

  return (
    <>
      <div
        role={expired ? undefined : "button"}
        tabIndex={expired ? undefined : 0}
        onClick={
          expired
            ? undefined
            : () => {
                setOpenEnvironment({
                  name: env.name,
                  status: env.status,
                  url: env.url,
                  expiresAt: env.expiresAt,
                  accessLabel: env.accessLabel,
                  items: [],
                });
              }
        }
        onKeyDown={
          expired
            ? undefined
            : (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenEnvironment({
                    name: env.name,
                    status: env.status,
                    url: env.url,
                    expiresAt: env.expiresAt,
                    accessLabel: env.accessLabel,
                    items: [],
                  });
                }
              }
        }
        className={`group/card flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left text-sm transition-colors ${expired ? "cursor-not-allowed bg-muted opacity-60" : "cursor-pointer bg-card hover:bg-muted/40"}`}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <CloudApp size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate font-medium text-foreground">
              {env.name}
              <span
                className={`inline-block size-2 shrink-0 rounded-full ${running ? "bg-[#24a148] dark:bg-[#42be65]" : "bg-[#697077]"}`}
              />
            </span>
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              Environment
              <span className="mx-0.5">·</span>
              {isPrivate ? (
                <>
                  <Locked size={12} />
                  Private
                </>
              ) : (
                <>
                  <Share size={12} />
                  {env.accessLabel}
                </>
              )}
              {expiry && (
                <>
                  <span className="mx-0.5">·</span>
                  {expiry}
                </>
              )}
            </span>
          </span>
        </span>
        {!expired && (
          <span
            className="ml-auto flex shrink-0 items-center gap-0.5 text-foreground opacity-0 transition-opacity group-hover/card:opacity-100"
            onClick={(e) => e.stopPropagation()}
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
                  <Move size={13} /> Move
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
                        message: `Deleted ${env.name}`,
                      });
                    }
                  }}
                >
                  <TrashCan size={13} /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )}
      </div>
      {shareOpen && (
        <ShareEnvironmentDialog
          name={env.name}
          accessLabel={env.accessLabel}
          expiresAt={env.expiresAt}
          onClose={() => setShareOpen(false)}
        />
      )}
    </>
  );
}

export function ArtifactsView() {
  const { data: artifacts = EMPTY_ARTIFACTS, isLoading } = useArtifacts();

  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<ArtifactDialog | null>(null);
  const closeDialog = () => setDialog(null);

  const allEnvs = useMemo(() => Object.values(environmentsByAgent).flat(), []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return artifacts;
    return artifacts.filter(
      (a) =>
        a.title.toLowerCase().includes(term) ||
        a.fileName.toLowerCase().includes(term),
    );
  }, [artifacts, search]);

  const filteredEnvs = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return allEnvs;
    return allEnvs.filter((e) => e.name.toLowerCase().includes(term));
  }, [allEnvs, search]);

  const totalBytes = useMemo(
    () => artifacts.reduce((sum, a) => sum + a.sizeBytes, 0),
    [artifacts],
  );

  const rowActions = {
    onPreview: (artifact: LibraryArtifact) =>
      setDialog({ kind: "preview", artifact }),
    onRename: (artifact: LibraryArtifact) =>
      setDialog({ kind: "rename", artifact }),
    onMove: (artifact: LibraryArtifact) =>
      setDialog({ kind: "move", artifact }),
    onShare: (artifact: LibraryArtifact) =>
      setDialog({ kind: "share", artifact }),
    onSetRetention: (artifact: LibraryArtifact) =>
      setDialog({ kind: "retention", artifact }),
  };

  const hasContent = artifacts.length > 0 || allEnvs.length > 0;
  const hasResults = filtered.length > 0 || filteredEnvs.length > 0;

  return (
    <div className="anim-in">
      {hasContent ? (
        <PageHeader
          title="Artifacts"
          description="Pages, files, and environments created by you and your agents."
          actions={
            <Button onClick={() => setDialog({ kind: "upload" })}>
              Upload artifact
            </Button>
          }
        />
      ) : (
        <Callout tone="muted" className="flex flex-col gap-4 py-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Artifacts
          </h1>
          <p className="max-w-[480px] text-[14px] text-foreground/80">
            Artifacts from every agent collect here. Create an agent to get
            started.
          </p>
        </Callout>
      )}

      {hasContent && (
        <div className="relative mt-7">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="pl-9"
            placeholder="Search artifacts and environments…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {isLoading && !hasContent && (
        <p className="mt-5 text-sm text-muted-foreground">Loading…</p>
      )}

      {hasContent && (
        <div className="mt-5 flex flex-col gap-2">
          {filteredEnvs.map((env) => (
            <EnvironmentRow key={env.id} env={env} />
          ))}
          {filtered.map((artifact) => (
            <ArtifactRow
              key={artifact.id}
              artifact={artifact}
              {...rowActions}
            />
          ))}
          {!hasResults && search.trim() && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No results for &ldquo;{search.trim()}&rdquo;
            </p>
          )}
        </div>
      )}

      {artifacts.length > 0 && (
        <p className="mt-5 text-sm text-muted-foreground">
          {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"}
          {allEnvs.length > 0 &&
            ` · ${allEnvs.length} environment${allEnvs.length === 1 ? "" : "s"}`}
          {" · "}
          {formatBytes(totalBytes)} stored
        </p>
      )}

      {dialog?.kind === "upload" && (
        <UploadArtifactDialog folders={[]} onClose={closeDialog} />
      )}
      {dialog?.kind === "rename" && (
        <RenameArtifactDialog
          artifact={dialog.artifact}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === "move" && (
        <MoveArtifactDialog artifact={dialog.artifact} onClose={closeDialog} />
      )}
      {dialog?.kind === "share" && (
        <ShareDialog artifact={dialog.artifact} onClose={closeDialog} />
      )}
      {dialog?.kind === "retention" && (
        <RetentionDialog artifact={dialog.artifact} onClose={closeDialog} />
      )}
      {dialog?.kind === "preview" && (
        <ArtifactPreviewDialog
          artifact={dialog.artifact}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
