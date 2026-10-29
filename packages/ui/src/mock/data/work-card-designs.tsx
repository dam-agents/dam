import {
  Calendar,
  ChatBot,
  Code,
  Download,
  Edit,
  Locked,
  Move,
  OverflowMenuVertical,
  Share,
  TrashCan,
} from "@carbon/icons-react";
import { useState } from "react";

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
            <Move size={13} /> Move
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
            <Move size={13} /> Move
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
        <Move size={13} /> Move
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
        <Move size={13} /> Move
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

export function WorkCardDesigns() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-foreground">
          Work Card Designs
        </h1>
        <p className="text-sm text-muted-foreground">
          Environment cards and artifact cards.
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
