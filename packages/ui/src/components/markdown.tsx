import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import { useMemo, useState } from "react";
import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
} from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import {
  ARTIFACT_LINK_PREFIX,
  ArtifactLinkChip,
  parseArtifactLink,
} from "../modules/artifacts/components/artifact-link-chip.js";

/** The default transform strips unknown schemes — let the internal
 *  platform:// artifact links through (even malformed ones, so the renderer
 *  can degrade them to plain text instead of a dead anchor). */
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
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div className="not-prose mb-3 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-text-muted hover:text-text-primary"
      >
        <Icon size={12} />
        <span className="font-mono uppercase tracking-[0.05em] text-[11px]">
          Frontmatter
        </span>
      </button>
      {open && (
        <pre className="mt-1.5 font-mono text-[11px] leading-[1.6] text-text-secondary whitespace-pre-wrap overflow-x-auto">
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
      a({ href, children }) {
        // Internal artifact links (platform://artifacts/<id>) render as a
        // preview chip that opens the docked artifact panel.
        const artifactId = parseArtifactLink(href);
        if (artifactId) {
          return (
            <ArtifactLinkChip artifactId={artifactId}>
              {children}
            </ArtifactLinkChip>
          );
        }
        // Malformed artifact link (prefix without an id) — degrade to plain
        // text; an anchor would be a dead platform:// navigation.
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
          <a href={href} target="_blank" rel="noopener noreferrer">
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
