import { Code, Download, Launch, View } from "@carbon/icons-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Markdown } from "@/components/markdown";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

export function SkillChip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function splitFrontmatter(raw: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { frontmatter: null, body: raw };
  return { frontmatter: match[1], body: raw.slice(match[0].length) };
}

function sizeLabel(content: string): string {
  const bytes = new TextEncoder().encode(content).length;
  return bytes < 1024
    ? `${bytes} B`
    : `${(bytes / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
}

export function SkillMarkdownModal({
  title,
  chips,
  headerAction,
  stateControl,
  path,
  linkHref,
  onDownload,
  isPending,
  isError,
  content,
  footer,
  onClose,
}: {
  title: string;
  chips?: ReactNode;
  headerAction?: ReactNode;
  stateControl?: ReactNode;
  path?: string | null;
  linkHref?: string | null;
  onDownload?: () => void;
  isPending: boolean;
  isError: boolean;
  content?: string | undefined;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const [showSource, setShowSource] = useState(false);
  const { frontmatter, body } = content
    ? splitFrontmatter(content)
    : { frontmatter: null, body: "" };

  return (
    <Modal widthClass="w-[860px]">
      <DialogHeader
        title={title}
        truncateTitle
        titleAccessory={headerAction}
        actions={stateControl}
        onClose={onClose}
      >
        {chips && <div className="mt-3 flex flex-wrap gap-2">{chips}</div>}
      </DialogHeader>

      <DialogBody>
        <div className="mb-3 flex items-center gap-2 font-mono text-xs text-muted-foreground">
          {path && <span className="truncate">{path}</span>}
          {path && content && <span>·</span>}
          {content && <span className="shrink-0">{sizeLabel(content)}</span>}
          <span className="flex-1" />
          {linkHref && (
            <Tooltip content="View SKILL.md on GitHub">
              <a
                href={linkHref}
                {...externalLinkProps}
                aria-label="View SKILL.md on GitHub"
                className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Launch size={16} />
              </a>
            </Tooltip>
          )}
          {onDownload && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Download skill"
              tooltip="Download skill"
              onClick={onDownload}
              className="text-muted-foreground"
            >
              <Download size={16} />
            </Button>
          )}
          {content && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => setShowSource((s) => !s)}
            >
              {showSource ? <View size={14} /> : <Code size={14} />}
              {showSource ? "Preview" : "Source"}
            </Button>
          )}
        </div>

        {}
        <div
          className={cn(
            "h-[52vh] overflow-y-auto rounded-lg border border-border",
            showSource ? "bg-muted" : "px-5 py-4",
          )}
        >
          {isPending ? (
            <div className="flex flex-col gap-2 p-1">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-full animate-pulse rounded bg-muted/60" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-muted/60" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted/60" />
            </div>
          ) : isError || content === undefined ? (
            <p className="text-sm text-muted-foreground">
              Couldn&rsquo;t load this skill&rsquo;s SKILL.md.
              {linkHref ? " Open it on GitHub from the link above." : ""}
            </p>
          ) : showSource ? (
            <pre className="px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {content}
            </pre>
          ) : (
            <>
              {frontmatter && (
                <pre className="mb-4 rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  {frontmatter}
                </pre>
              )}
              <Markdown>{body}</Markdown>
            </>
          )}
        </div>
      </DialogBody>

      {}
      {footer && (
        <DialogFooter className="justify-start">{footer}</DialogFooter>
      )}
    </Modal>
  );
}
