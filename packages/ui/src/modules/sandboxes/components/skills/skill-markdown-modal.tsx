import { Launch } from "@carbon/icons-react";

import { Markdown } from "@/components/markdown";
import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Tooltip } from "@/components/ui/tooltip";
import { externalLinkProps } from "@/lib/external-link";

/**
 * The shell every skill preview renders into: header, loading skeleton, error
 * state, and the `<Markdown>` body. Presentational — each mode owns its own
 * query and hands the result here, so a source-backed skill and a Local Skill
 * share one piece of markup instead of two that drift.
 */
export function SkillMarkdownModal({
  title,
  description,
  linkHref,
  isPending,
  isError,
  content,
  onClose,
}: {
  title: string;
  description?: string | undefined;
  /** GitHub blob URL for the rendered file. A Local Skill has none. */
  linkHref?: string | null;
  isPending: boolean;
  isError: boolean;
  content?: string | undefined;
  onClose: () => void;
}) {
  return (
    <Modal widthClass="w-[720px]">
      <DialogHeader
        title={title}
        truncateTitle
        titleAccessory={
          linkHref && (
            <Tooltip content="View SKILL.md on GitHub">
              <a
                href={linkHref}
                {...externalLinkProps}
                aria-label="View SKILL.md on GitHub"
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Launch size={15} />
              </a>
            </Tooltip>
          )
        }
        subtitle={
          description && <span className="block truncate">{description}</span>
        }
        onClose={onClose}
      />

      <DialogBody>
        {isPending ? (
          <div className="flex flex-col gap-2">
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
        ) : (
          <Markdown>{content}</Markdown>
        )}
      </DialogBody>
    </Modal>
  );
}
