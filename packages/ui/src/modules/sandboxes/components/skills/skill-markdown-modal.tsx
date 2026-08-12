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

/** One fact about the skill, as a chip under its name. Provenance reads as a
 *  row of small facts rather than a paragraph, so the eye can skip to the one
 *  it came for. */
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

/** Split a leading YAML frontmatter block off the body. Rendered separately
 *  because passing `---`-fenced YAML through a Markdown renderer turns the
 *  opening fence into a horizontal rule and the keys into a paragraph. */
function splitFrontmatter(raw: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { frontmatter: null, body: raw };
  return { frontmatter: match[1], body: raw.slice(match[0].length) };
}

/** UTF-8 size of the loaded file. Computed here rather than carried on the
 *  contract: the bytes are already in hand, and a second number from the
 *  server could disagree with the text on screen. */
function sizeLabel(content: string): string {
  const bytes = new TextEncoder().encode(content).length;
  return bytes < 1024
    ? `${bytes} B`
    : `${(bytes / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
}

/**
 * The shell every skill preview renders into: header (name, drift action, state
 * control), provenance chips, the file strip with its Source⇄Preview toggle,
 * the body, and an optional footer. Presentational — each mode owns its own
 * query and hands the result here, so a source-backed skill and a Local Skill
 * share one piece of markup instead of two that drift.
 */
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
  /** Provenance chips under the title — visibility, source, version, PR. */
  chips?: ReactNode;
  /** Sits immediately right of the name. Today: "Update to latest" on a
   *  drifted skill, so the drawer offers the fix where the problem is named. */
  headerAction?: ReactNode;
  /** Whether the skill is on, as a switch or a static label — right-aligned,
   *  at eye level with the name. */
  stateControl?: ReactNode;
  /** Repo- or pod-relative path of the file being shown. */
  path?: string | null;
  /** GitHub blob URL for the rendered file. A Local Skill has none. */
  linkHref?: string | null;
  /** Download the whole skill directory. Absent for source-backed skills,
   *  which have no download path — the GitHub link is the way out. */
  onDownload?: () => void;
  isPending: boolean;
  isError: boolean;
  content?: string | undefined;
  /** Footer actions. Created-here skills carry publish and delete; every other
   *  kind has nothing to put there, and the region is dropped rather than
   *  rendered empty. */
  footer?: ReactNode;
  onClose: () => void;
}) {
  // Rendered by default: the point of an in-product preview is not having to
  // read raw Markdown. The raw file stays one click away for anyone checking
  // frontmatter or whitespace.
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

        {/* Fixed height, so flipping Source⇄Preview or landing a slow read
            never resizes the dialog under the pointer. */}
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

      {/* Secondary and destructive only. Nothing sits in the primary
          bottom-right slot, so Delete can't be mistaken for a confirm. */}
      {footer && (
        <DialogFooter className="justify-start">{footer}</DialogFooter>
      )}
    </Modal>
  );
}
