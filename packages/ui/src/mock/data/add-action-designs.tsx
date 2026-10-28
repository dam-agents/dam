import {
  Add,
  Close,
  Dashboard,
  Document,
  DocumentAdd,
  Download,
  Folder,
  FolderAdd,
  Search,
  Upload,
} from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm text-muted-foreground">{children}</p>;
}

const ARTIFACT_ITEMS = [
  { title: "Landing page", detail: "HTML · Public" },
  { title: "Dashboard component", detail: "JSX · 3 people" },
  { title: "API reference", detail: "Markdown · Private" },
];

const FILE_ITEMS = [
  { title: "src/index.ts", detail: "TypeScript · 2.4 KB" },
  { title: "README.md", detail: "Markdown · 1.1 KB" },
  { title: "package.json", detail: "JSON · 840 B" },
];

function MockList({ items }: { items: { title: string; detail: string }[] }) {
  return (
    <div className="flex flex-col gap-0.5 px-1.5 py-1">
      {items.map((item) => (
        <div
          key={item.title}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/40"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {item.title}
            </span>
            <span className="block text-xs text-muted-foreground">
              {item.detail}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function PanelShell({
  title,
  header,
  children,
}: {
  title: string;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex w-[320px] flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="ml-auto flex items-center gap-0.5">
          {header}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Close size={16} />
          </button>
        </span>
      </div>
      {children}
    </div>
  );
}

function PanelPair({
  label,
  filesHeader,
  artifactsHeader,
  filesExtra,
  artifactsExtra,
}: {
  label: string;
  filesHeader: ReactNode;
  artifactsHeader: ReactNode;
  filesExtra?: ReactNode;
  artifactsExtra?: ReactNode;
}) {
  return (
    <section>
      <SectionHeading>{label}</SectionHeading>
      <div className="flex gap-4">
        <PanelShell title="Files" header={filesHeader}>
          {filesExtra}
          <MockList items={FILE_ITEMS} />
        </PanelShell>
        <PanelShell title="Artifacts" header={artifactsHeader}>
          {artifactsExtra}
          <MockList items={ARTIFACT_ITEMS} />
        </PanelShell>
      </div>
    </section>
  );
}

function IconBtn({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

/* ─── Option 1: Single "+" dropdown ─── */

function AddDropdown({
  items,
}: {
  items: { icon: ReactNode; label: string }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Add"
        >
          <Add size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem key={item.label}>
            {item.icon} {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Option1() {
  return (
    <PanelPair
      label="Option 1 — Single + dropdown"
      filesHeader={
        <AddDropdown
          items={[
            { icon: <DocumentAdd size={14} />, label: "New file" },
            { icon: <FolderAdd size={14} />, label: "New folder" },
            { icon: <Upload size={14} />, label: "Upload file" },
          ]}
        />
      }
      artifactsHeader={
        <AddDropdown
          items={[
            { icon: <Upload size={14} />, label: "Upload artifact" },
            { icon: <FolderAdd size={14} />, label: "New folder" },
          ]}
        />
      }
    />
  );
}

/* ─── Option 2: Split icon buttons ─── */

function Option2() {
  return (
    <PanelPair
      label="Option 2 — Split icon buttons"
      filesHeader={
        <>
          <IconBtn icon={<DocumentAdd size={16} />} label="New file" />
          <IconBtn icon={<FolderAdd size={16} />} label="New folder" />
          <IconBtn icon={<Upload size={16} />} label="Upload" />
        </>
      }
      artifactsHeader={
        <>
          <IconBtn icon={<Upload size={16} />} label="Upload artifact" />
          <IconBtn icon={<FolderAdd size={16} />} label="New folder" />
        </>
      }
    />
  );
}

/* ─── Option 3: Empty-state card + header "+" ─── */

function EmptyCard({
  actions,
}: {
  actions: { icon: ReactNode; label: string }[];
}) {
  return (
    <div className="mx-2.5 my-2 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-6">
      <span className="text-sm text-muted-foreground">Nothing here yet</span>
      <div className="flex flex-wrap justify-center gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Option3() {
  const [filesEmpty, setFilesEmpty] = useState(true);
  const [artifactsEmpty, setArtifactsEmpty] = useState(true);

  return (
    <section>
      <SectionHeading>Option 3 — Empty-state card + header +</SectionHeading>
      <SectionNote>
        Click the empty state to toggle to the populated view with the +
        dropdown.
      </SectionNote>
      <div className="flex gap-4">
        <PanelShell
          title="Files"
          header={
            !filesEmpty ? (
              <AddDropdown
                items={[
                  { icon: <DocumentAdd size={14} />, label: "New file" },
                  { icon: <FolderAdd size={14} />, label: "New folder" },
                  { icon: <Upload size={14} />, label: "Upload file" },
                ]}
              />
            ) : null
          }
        >
          {filesEmpty ? (
            <button
              type="button"
              className="w-full"
              onClick={() => setFilesEmpty(false)}
            >
              <EmptyCard
                actions={[
                  { icon: <DocumentAdd size={14} />, label: "New file" },
                  { icon: <FolderAdd size={14} />, label: "New folder" },
                  { icon: <Upload size={14} />, label: "Upload" },
                ]}
              />
            </button>
          ) : (
            <MockList items={FILE_ITEMS} />
          )}
        </PanelShell>
        <PanelShell
          title="Artifacts"
          header={
            !artifactsEmpty ? (
              <AddDropdown
                items={[
                  { icon: <Upload size={14} />, label: "Upload artifact" },
                  { icon: <FolderAdd size={14} />, label: "New folder" },
                ]}
              />
            ) : null
          }
        >
          {artifactsEmpty ? (
            <button
              type="button"
              className="w-full"
              onClick={() => setArtifactsEmpty(false)}
            >
              <EmptyCard
                actions={[
                  { icon: <Upload size={14} />, label: "Upload artifact" },
                  { icon: <FolderAdd size={14} />, label: "New folder" },
                ]}
              />
            </button>
          ) : (
            <MockList items={ARTIFACT_ITEMS} />
          )}
        </PanelShell>
      </div>
    </section>
  );
}

/* ─── Option 4: Inline "New…" row at list top ─── */

function InlineNewRow({
  actions,
}: {
  actions: { icon: ReactNode; label: string }[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-1.5 pt-1">
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <Add size={14} />
          New…
        </button>
      ) : (
        <div className="flex items-center gap-1 rounded-lg bg-muted/40 px-2 py-1.5 anim-in">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => setExpanded(false)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              {a.icon}
              {a.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Close size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function Option4() {
  return (
    <PanelPair
      label='Option 4 — Inline "New…" row at list top'
      filesHeader={null}
      artifactsHeader={null}
      filesExtra={
        <InlineNewRow
          actions={[
            { icon: <DocumentAdd size={14} />, label: "New file" },
            { icon: <FolderAdd size={14} />, label: "Folder" },
            { icon: <Upload size={14} />, label: "Upload" },
          ]}
        />
      }
      artifactsExtra={
        <InlineNewRow
          actions={[
            { icon: <Upload size={14} />, label: "Upload" },
            { icon: <FolderAdd size={14} />, label: "Folder" },
          ]}
        />
      }
    />
  );
}

/* ─── Option 5: Action bar below search ─── */

function ActionBar({
  actions,
}: {
  actions: { icon: ReactNode; label: string }[];
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-2.5 py-1.5">
      <div className="flex h-8 flex-1 items-center gap-2 rounded-lg bg-muted/70 px-2.5 text-sm text-muted-foreground">
        <Search size={14} className="shrink-0" />
        <input
          type="text"
          placeholder="Search…"
          className="h-full flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      <div className="flex items-center">
        {actions.map((a) => (
          <IconBtn key={a.label} icon={a.icon} label={a.label} />
        ))}
      </div>
    </div>
  );
}

function Option5() {
  return (
    <PanelPair
      label="Option 5 — Action bar below header"
      filesHeader={null}
      artifactsHeader={null}
      filesExtra={
        <ActionBar
          actions={[
            { icon: <DocumentAdd size={16} />, label: "New file" },
            { icon: <FolderAdd size={16} />, label: "New folder" },
            { icon: <Upload size={16} />, label: "Upload" },
          ]}
        />
      }
      artifactsExtra={
        <ActionBar
          actions={[
            { icon: <Upload size={16} />, label: "Upload artifact" },
            { icon: <FolderAdd size={16} />, label: "New folder" },
          ]}
        />
      }
    />
  );
}

/* ─── Page ─── */

export function AddActionDesigns() {
  return (
    <div className="space-y-12">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-foreground">
          Add Action Patterns
        </h1>
        <p className="text-sm text-muted-foreground">
          Five approaches for a consistent add/create action across the Files
          and Artifacts panels.
        </p>
      </div>
      <Option1 />
      <Option2 />
      <Option3 />
      <Option4 />
      <Option5 />
    </div>
  );
}
