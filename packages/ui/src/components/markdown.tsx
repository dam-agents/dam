import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

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

  const components = useMemo<Components | undefined>(
    () =>
      onFileClick
        ? {
            a({ href, children }) {
              if (href && isRelativePath(href)) {
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
          }
        : undefined,
    [onFileClick],
  );

  return (
    <div className="prose">
      {frontmatter !== null && <FrontmatterBlock source={frontmatter} />}
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
