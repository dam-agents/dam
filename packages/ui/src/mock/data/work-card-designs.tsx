import {
  Calendar,
  ChatBot,
  Code,
  Download,
  Edit,
  FolderMoveTo,
  Locked,
  OverflowMenuVertical,
  Restart,
  Share,
  TrashCan,
} from "@carbon/icons-react";
import { useState } from "react";

import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import { WorkCardShell } from "../../modules/sessions/components/work-cards/work-card-shell.js";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

type Visibility =
  | { kind: "private" }
  | { kind: "restricted"; count: number }
  | { kind: "public" };

function VisibilityLabel({ visibility }: { visibility: Visibility }) {
  if (visibility.kind === "private") {
    return (
      <>
        <Locked size={12} />
        Private
      </>
    );
  }
  if (visibility.kind === "restricted") {
    return (
      <>
        <Share size={12} />
        {visibility.count} people
      </>
    );
  }
  return (
    <>
      <Share size={12} />
      Public
    </>
  );
}

function CardDetail({
  label,
  visibility,
  expiry,
}: {
  label: string;
  visibility: Visibility;
  expiry?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <span className="mx-0.5">·</span>
      <VisibilityLabel visibility={visibility} />
      {expiry && (
        <>
          <span className="mx-0.5">·</span>
          {expiry}
        </>
      )}
    </span>
  );
}

function EnvironmentTrailingIcon() {
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
          <DropdownMenuItem onSelect={() => {}}>
            <Share size={13} /> Share
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => {}}>
            <Calendar size={13} /> Set expiration
          </DropdownMenuItem>
          <DropdownMenuItem tone="danger" onSelect={() => {}}>
            <TrashCan size={13} /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function ArtifactTrailingIcon() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <span
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex transition-opacity ${menuOpen ? "opacity-100" : "opacity-0 group-hover/card:opacity-100"}`}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Artifact actions">
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
          <DropdownMenuItem onSelect={() => {}}>
            <Share size={13} /> Share
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => {}}>
            <Code size={13} /> View source
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => {}}>
            <Download size={13} /> Download
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => {}}>
            <Calendar size={13} /> Set expiration
          </DropdownMenuItem>
          <DropdownMenuItem tone="danger" onSelect={() => {}}>
            <TrashCan size={13} /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function BrowserTrailingIcon() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <span
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex transition-opacity ${menuOpen ? "opacity-100" : "opacity-0 group-hover/card:opacity-100"}`}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Browser actions">
            <OverflowMenuVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => {}}>
            <Restart size={13} /> Restart browser
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem tone="danger" onSelect={() => {}}>
            <TrashCan size={13} /> Clear browser data
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

const ENV_CARDS: {
  label: string;
  expiry?: string;
  visibility: Visibility;
  expired?: boolean;
}[] = [
  {
    label: "Restricted with expiry",
    expiry: "Expires in 30 days",
    visibility: { kind: "restricted", count: 5 },
  },
  {
    label: "Restricted with expiry",
    expiry: "Expires in 7 days",
    visibility: { kind: "restricted", count: 3 },
  },
  {
    label: "Private with expiry",
    expiry: "Expires in 1 day",
    visibility: { kind: "private" },
  },
  {
    label: "Private expired",
    expiry: "Expired",
    visibility: { kind: "private" },
    expired: true,
  },
];

const ARTIFACT_CARDS: {
  title: string;
  kind: string;
  visibility: Visibility;
  expiry?: string;
}[] = [
  {
    title: "Landing page",
    kind: "HTML",
    visibility: { kind: "public" },
    expiry: "Expires in 14 days",
  },
  {
    title: "Dashboard component",
    kind: "JSX",
    visibility: { kind: "restricted", count: 3 },
    expiry: "Expires in 7 days",
  },
  {
    title: "API reference",
    kind: "Markdown",
    visibility: { kind: "restricted", count: 5 },
  },
  {
    title: "helper-utils.ts",
    kind: "Code",
    visibility: { kind: "private" },
    expiry: "Expires in 3 days",
  },
  {
    title: "Meeting notes",
    kind: "Text",
    visibility: { kind: "private" },
  },
  {
    title: "export.csv",
    kind: "File",
    visibility: { kind: "private" },
  },
];

function EnvironmentOverflowMenuPanel() {
  return (
    <div className="w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <ChatBot size={13} /> Ask agent to edit
      </button>
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <Edit size={13} /> Rename
      </button>
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <FolderMoveTo size={13} /> Move
      </button>
      <div className="my-1 h-px bg-border" />
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <Share size={13} /> Share
      </button>
      <div className="my-1 h-px bg-border" />
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <Calendar size={13} /> Set expiration
      </button>
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10">
        <TrashCan size={13} /> Delete
      </button>
    </div>
  );
}

function ArtifactOverflowMenuPanel() {
  return (
    <div className="w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <ChatBot size={13} /> Ask agent to edit
      </button>
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <Edit size={13} /> Rename
      </button>
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <FolderMoveTo size={13} /> Move
      </button>
      <div className="my-1 h-px bg-border" />
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <Share size={13} /> Share
      </button>
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <Code size={13} /> View source
      </button>
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <Download size={13} /> Download
      </button>
      <div className="my-1 h-px bg-border" />
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <Calendar size={13} /> Set expiration
      </button>
      <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10">
        <TrashCan size={13} /> Delete
      </button>
    </div>
  );
}

const PROCESS_KIND_LABEL: Record<string, string> = {
  "harness-task": "Background task",
  detached: "Detached",
  "startup-item": "Login item",
};

type ProcessStatus =
  | "running"
  | "running-awake"
  | "running-hibernates"
  | "exited"
  | "stopped"
  | "hibernated";

const PROCESS_STATUS_CONFIG: Record<
  ProcessStatus,
  { label: string; badgeClass: string; dot?: boolean }
> = {
  running: {
    label: "Running",
    badgeClass: "bg-[#24a148]/10 text-[#24a148]",
    dot: true,
  },
  "running-awake": {
    label: "Keeping it awake",
    badgeClass: "bg-[#24a148]/10 text-[#24a148]",
    dot: true,
  },
  "running-hibernates": {
    label: "Running",
    badgeClass: "bg-[#24a148]/10 text-[#24a148]",
    dot: true,
  },
  exited: {
    label: "Exited",
    badgeClass: "bg-[#24a148]/10 text-[#24a148]",
  },
  stopped: {
    label: "Stopped",
    badgeClass: "bg-muted text-muted-foreground",
  },
  hibernated: {
    label: "Hibernated",
    badgeClass: "bg-muted text-muted-foreground",
  },
};

function ProcessCardDemo({
  command,
  processKind,
  status,
  exitCode,
  containerId,
}: {
  command: string;
  processKind?: string;
  status: ProcessStatus;
  exitCode?: number;
  containerId?: string;
}) {
  const config = PROCESS_STATUS_CONFIG[status];
  const kindLabel = processKind ? PROCESS_KIND_LABEL[processKind] : null;
  const isExitError =
    status === "exited" && exitCode !== undefined && exitCode !== 0;
  const badgeLabel = isExitError ? `exit ${exitCode}` : config.label;
  const badgeClass = isExitError
    ? "bg-[#dc2626]/10 text-[#dc2626]"
    : config.badgeClass;
  const title = containerId ?? command;

  return (
    <WorkCardShell
      title={<code className="font-mono text-xs font-medium">{title}</code>}
      detail={kindLabel}
      accessory={
        <span className="flex items-center gap-1.5">
          {config.dot && (
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#24a148]" />
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass}`}
          >
            {badgeLabel}
          </span>
        </span>
      }
      onClick={() => {}}
    />
  );
}

export function WorkCardDesigns() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-foreground">
          Work Card Designs
        </h1>
        <p className="text-sm text-muted-foreground">
          Environment, artifact, browser, changes, and process cards.
        </p>
      </div>

      <section>
        <SectionHeading>Environment Card</SectionHeading>
        <div className="space-y-2">
          {ENV_CARDS.map((card) => (
            <WorkCardShell
              key={card.label}
              title={
                <>
                  csv-export-preview
                  <span
                    className={`ml-1.5 inline-block size-2 shrink-0 translate-y-[-0.5px] rounded-full align-middle ${card.expired ? "bg-[#697077]" : "bg-[#24a148] dark:bg-[#42be65]"}`}
                  />
                </>
              }
              detail={
                <CardDetail
                  label="Environment"
                  visibility={card.visibility}
                  expiry={card.expiry}
                />
              }
              trailing={card.expired ? undefined : <EnvironmentTrailingIcon />}
              disabled={card.expired}
              onClick={() => {}}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionHeading>Artifact Card</SectionHeading>
        <div className="space-y-2">
          {ARTIFACT_CARDS.map((a) => (
            <WorkCardShell
              key={a.kind}
              title={a.title}
              detail={
                <CardDetail
                  label={a.kind}
                  visibility={a.visibility}
                  expiry={a.expiry}
                />
              }
              trailing={<ArtifactTrailingIcon />}
              onClick={() => {}}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionHeading>Browser Card</SectionHeading>
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Default</p>
          <WorkCardShell
            title="localhost:5173/reports"
            detail="Browser"
            trailing={<BrowserTrailingIcon />}
            onClick={() => {}}
          />

          <p className="mt-2 text-xs text-muted-foreground">Unavailable</p>
          <WorkCardShell
            title="Browser"
            detail="No browser display in this agent's image."
            disabled
          />
        </div>
      </section>

      <section>
        <SectionHeading>Changes Card</SectionHeading>
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">No pull request</p>
          <WorkCardShell
            title="3 files changed"
            detail="platform · fix/csv-export"
            accessory={
              <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums">
                <span className="text-[#24a148] dark:text-[#42be65]">+34</span>
                <span className="text-[#dc2626] dark:text-[#fa4d56]">-6</span>
              </span>
            }
            onClick={() => {}}
          />

          <p className="mt-2 text-xs text-muted-foreground">Draft</p>
          <WorkCardShell
            title="5 files changed"
            detail="platform · feat/auth-flow"
            accessory={
              <Badge variant="muted" size="sm">
                #87 <span className="ml-1">Draft</span>
              </Badge>
            }
            onClick={() => {}}
          />

          <p className="mt-2 text-xs text-muted-foreground">Review pending</p>
          <WorkCardShell
            title="3 files changed"
            detail="platform · fix/csv-export"
            accessory={
              <Badge variant="pending" size="sm">
                #142 <span className="ml-1">Review pending</span>
              </Badge>
            }
            onClick={() => {}}
          />

          <p className="mt-2 text-xs text-muted-foreground">Approved</p>
          <WorkCardShell
            title="2 files changed"
            detail="docs · chore/update-readme"
            accessory={
              <Badge variant="success" size="sm">
                #56 <span className="ml-1">Approved</span>
              </Badge>
            }
            onClick={() => {}}
          />

          <p className="mt-2 text-xs text-muted-foreground">
            Changes requested
          </p>
          <WorkCardShell
            title="8 files changed"
            detail="platform · feat/new-dashboard"
            accessory={
              <Badge variant="danger" size="sm">
                #201 <span className="ml-1">Changes requested</span>
              </Badge>
            }
            onClick={() => {}}
          />

          <p className="mt-2 text-xs text-muted-foreground">Merged</p>
          <WorkCardShell
            title="3 files changed"
            detail="platform · fix/csv-export"
            accessory={
              <Badge variant="template" size="sm">
                #142 <span className="ml-1">Merged</span>
              </Badge>
            }
            onClick={() => {}}
          />

          <p className="mt-2 text-xs text-muted-foreground">Closed</p>
          <WorkCardShell
            title="1 file changed"
            detail="platform · experiment/old-feature"
            accessory={
              <Badge variant="danger" size="sm">
                <span className="line-through">#99</span>
                <span className="ml-1">Closed</span>
              </Badge>
            }
            onClick={() => {}}
          />

          <p className="mt-2 text-xs text-muted-foreground">Merge conflicts</p>
          <WorkCardShell
            title="4 files changed"
            detail="platform · feat/data-pipeline"
            accessory={
              <Badge variant="conflict" size="sm">
                #178 <span className="ml-1">Merge conflicts</span>
              </Badge>
            }
            onClick={() => {}}
          />
        </div>
      </section>

      <section>
        <SectionHeading>Process Card</SectionHeading>
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Running, keeping agent awake
          </p>
          <ProcessCardDemo
            command="npm run dev"
            processKind="detached"
            status="running-awake"
          />

          <p className="mt-2 text-xs text-muted-foreground">
            Running, stops when agent sleeps
          </p>
          <ProcessCardDemo
            command="npm test -- --watch"
            processKind="harness-task"
            status="running-hibernates"
          />

          <p className="mt-2 text-xs text-muted-foreground">
            Exited successfully
          </p>
          <ProcessCardDemo
            command="npm run build"
            processKind="harness-task"
            status="exited"
            exitCode={0}
          />

          <p className="mt-2 text-xs text-muted-foreground">
            Exited with error
          </p>
          <ProcessCardDemo
            command="npm test -- --ci"
            processKind="harness-task"
            status="exited"
            exitCode={1}
          />

          <p className="mt-2 text-xs text-muted-foreground">Stopped by you</p>
          <ProcessCardDemo
            command="python train.py"
            processKind="detached"
            status="stopped"
          />

          <p className="mt-2 text-xs text-muted-foreground">
            Ended when agent slept
          </p>
          <ProcessCardDemo
            command="python eval.py"
            processKind="detached"
            status="hibernated"
          />

          <p className="mt-2 text-xs text-muted-foreground">
            Container process
          </p>
          <ProcessCardDemo
            command="docker run postgres"
            processKind="detached"
            status="running-awake"
            containerId="a1b2c3d4e5f6"
          />
        </div>
      </section>

      <section>
        <SectionHeading>Environment Overflow Menu</SectionHeading>
        <EnvironmentOverflowMenuPanel />
      </section>

      <section>
        <SectionHeading>Artifact Overflow Menu</SectionHeading>
        <ArtifactOverflowMenuPanel />
      </section>
    </div>
  );
}
