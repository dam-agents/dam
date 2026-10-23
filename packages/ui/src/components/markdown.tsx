import { useMemo, useState } from "react";
import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
} from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { MarkdownCodeBlock } from "@/components/markdown-code-block";
import { DisclosureToggle } from "@/components/ui/disclosure";
import { externalLinkProps } from "@/lib/external-link";

import {
  ARTIFACT_LINK_PREFIX,
  ArtifactLinkChip,
  parseArtifactLink,
} from "../modules/artifacts/components/artifact-link-chip.js";

function allowArtifactLinks(url: string): string {
  return url.startsWith(ARTIFACT_LINK_PREFIX) ? url : defaultUrlTransform(url);
}

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function splitFrontmatter(source: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = source.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: null, body: source };
  return { frontmatter: match[1], body: source.slice(match[0].length) };
}

function isRelativePath(href: string) {
  if (!href) return false;
  if (/^https?:\/\//.test(href)) return false;
  if (href.startsWith("mailto:")) return false;
  if (href.startsWith("#")) return false;
  return true;
}

function FrontmatterBlock({ source }: { source: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="not-prose mb-3 text-xs">
      <DisclosureToggle
        open={open}
        onToggle={() => setOpen((v) => !v)}
        chevronSize={12}
        className="gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <span className="font-mono uppercase tracking-[0.05em] text-[11px]">
          Frontmatter
        </span>
      </DisclosureToggle>
      {open && (
        <pre className="mt-1.5 font-mono text-[11px] leading-[1.6] text-muted-foreground whitespace-pre-wrap overflow-x-auto">
          {source}
        </pre>
      )}
    </div>
  );
}

export function Markdown({
  children,
  onFileClick,
}: {
  children: string;
  onFileClick?: (path: string) => void;
}) {
  const { frontmatter, body } = useMemo(
    () => splitFrontmatter(children),
    [children],
  );

  const components = useMemo<Components>(
    () => ({
      pre: MarkdownCodeBlock,
      a({ href, children }) {
        const artifactId = parseArtifactLink(href);
        if (artifactId) {
          return (
            <ArtifactLinkChip artifactId={artifactId}>
              {children}
            </ArtifactLinkChip>
          );
        }
        if (href?.startsWith(ARTIFACT_LINK_PREFIX)) {
          return <span>{children}</span>;
        }
        if (onFileClick && href && isRelativePath(href)) {
          const path = href.replace(/^\.\//, "");
          return (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onFileClick(path);
              }}
              className="cursor-pointer"
            >
              {children}
            </a>
          );
        }
        return (
          <a href={href} {...externalLinkProps}>
            {children}
          </a>
        );
      },
    }),
    [onFileClick],
  );

  return (
    <div className="prose">
      {frontmatter !== null && <FrontmatterBlock source={frontmatter} />}
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
        urlTransform={allowArtifactLinks}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
