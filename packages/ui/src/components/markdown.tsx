import { ChevronDown, ChevronRight } from "@carbon/icons-react";
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

  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        if (onFileClick && href && isRelativePath(href)) {
          const path = href.replace(/^\.\//, "");
          return (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onFileClick(path);
              }}
              className="text-primary hover:underline cursor-pointer"
            >
              {children}
            </a>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {children}
          </a>
        );
      },
      p({ children }) {
        return <p className="my-1.5 leading-relaxed">{children}</p>;
      },
      strong({ children }) {
        return <strong className="font-semibold text-foreground">{children}</strong>;
      },
      em({ children }) {
        return <em className="italic">{children}</em>;
      },
      h1({ children }) {
        return <h1 className="text-[15px] font-semibold text-foreground mt-4 mb-1.5">{children}</h1>;
      },
      h2({ children }) {
        return <h2 className="text-[14px] font-semibold text-foreground mt-3 mb-1">{children}</h2>;
      },
      h3({ children }) {
        return <h3 className="text-[14px] font-medium text-foreground mt-2 mb-1">{children}</h3>;
      },
      ul({ children }) {
        return <ul className="my-1.5 ml-4 list-disc text-foreground/80 space-y-0.5">{children}</ul>;
      },
      ol({ children }) {
        return <ol className="my-1.5 ml-4 list-decimal text-foreground/80 space-y-0.5">{children}</ol>;
      },
      li({ children }) {
        return <li className="leading-relaxed">{children}</li>;
      },
      code({ className, children }) {
        const isBlock = className?.includes("language-") || className?.includes("hljs");
        if (isBlock) {
          return (
            <code className={`${className ?? ""} text-[12px] leading-[1.6]`}>
              {children}
            </code>
          );
        }
        return (
          <code className="text-[13px] font-mono text-foreground/90">
            {children}
          </code>
        );
      },
      pre({ children }) {
        return (
          <pre className="my-2 rounded-md bg-muted/50 border border-border px-3 py-2 overflow-x-auto text-[12px] font-mono leading-[1.6]">
            {children}
          </pre>
        );
      },
      blockquote({ children }) {
        return (
          <blockquote className="my-2 ml-0 pl-3 border-l-2 border-border text-muted-foreground italic">
            {children}
          </blockquote>
        );
      },
      hr() {
        return <hr className="my-3 border-border" />;
      },
    }),
    [onFileClick],
  );

  return (
    <div className="text-[14px] text-foreground/80">
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
